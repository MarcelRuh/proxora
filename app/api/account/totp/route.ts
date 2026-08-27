import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { verifyPassword } from "@/lib/password";
import { ValidationError } from "@/lib/errors";
import { generateTotpSecret, totpOtpauthUrl, verifyTotp } from "@/lib/totp";
import QRCode from "qrcode";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("begin") }),
  z.object({ action: z.literal("enable"), secret: z.string().min(16), code: z.string().min(6) }),
  z.object({
    action: z.literal("disable"),
    code: z.string().min(6),
    password: z.string().min(1),
  }),
]);

export const GET = apiRoute(null, async (_req, session) => {
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  return json({ enabled: Boolean(user?.totpEnabled) });
});

export const POST = apiRoute(null, async (req, session) => {
  const body = schema.parse(await req.json());
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) throw new ValidationError("User not found");

  if (body.action === "begin") {
    if (user.totpEnabled) throw new ValidationError("2FA is already enabled");
    const secret = generateTotpSecret();
    const otpauth = totpOtpauthUrl(secret, user.username);
    const qr = await QRCode.toDataURL(otpauth, { margin: 1, width: 192, color: { dark: "#111111", light: "#ffffff" } });
    return json({ secret, otpauth, qr });
  }

  if (body.action === "enable") {
    if (user.totpEnabled) throw new ValidationError("2FA is already enabled");
    if (!verifyTotp(body.secret, body.code)) throw new ValidationError("INVALID_TOTP");
    await prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: true, totpSecret: encryptSecret(body.secret) },
    });
    await writeAuditLog({
      userId: session.user.id,
      ip: await clientIp(),
      action: AUDIT_ACTIONS.TOTP_ENABLED,
      target: session.user.username,
      result: "SUCCESS",
    });
    return json({ enabled: true });
  }

  if (!user.totpEnabled || !user.totpSecret) throw new ValidationError("2FA is not enabled");
  if (!(await verifyPassword(body.password, user.passwordHash))) {
    throw new ValidationError("CURRENT_PASSWORD_INVALID");
  }
  let secret: string;
  try {
    secret = decryptSecret(user.totpSecret);
  } catch {
    throw new ValidationError("INVALID_TOTP");
  }
  if (!verifyTotp(secret, body.code)) throw new ValidationError("INVALID_TOTP");
  await prisma.user.update({
    where: { id: user.id },
    data: { totpEnabled: false, totpSecret: null },
  });
  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: AUDIT_ACTIONS.TOTP_DISABLED,
    target: session.user.username,
    result: "SUCCESS",
  });
  return json({ enabled: false });
});
