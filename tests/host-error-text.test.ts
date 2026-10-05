import { describe, expect, it } from "vitest";
import { hostErrorText } from "@/lib/host-error-text";
import { translate } from "@/lib/i18n/messages";

describe("hostErrorText", () => {
  const t = (key: Parameters<typeof translate>[1]) => translate("de", key);

  it("translates the known dashboard fallbacks", () => {
    expect(hostErrorText("Unable to connect", t)).toBe("Keine Verbindung zum Host");
    expect(hostErrorText("Host did not respond in time", t)).toBe("Der Host hat nicht rechtzeitig geantwortet");
    expect(hostErrorText("Unable to connect to pve: timeout", t)).toBe("Der Host hat nicht rechtzeitig geantwortet");
    expect(hostErrorText("Connection failed: ECONNREFUSED", t)).toBe("Keine Verbindung zum Host");
    expect(hostErrorText("Connection failed: The operation was aborted due to timeout", t)).toBe(
      "Der Host hat nicht rechtzeitig geantwortet",
    );
    expect(hostErrorText("Permission check failed (user != root@pam)", t)).toBe("Proxmox hat die Berechtigung verweigert");
    expect(hostErrorText("authentication failure", t)).toBe("Proxmox hat die Anmeldung abgelehnt");
    expect(hostErrorText("self signed certificate", t)).toBe("Das Zertifikat des Hosts ist nicht vertrauenswürdig");
  });

  it("keeps a Proxmox message that has no translation", () => {
    expect(hostErrorText("got timeout", t)).toBe("Der Host hat nicht rechtzeitig geantwortet");
    expect(hostErrorText("VM 100 is locked (backup)", t)).toBe("VM 100 is locked (backup)");
    expect(hostErrorText(null, t)).toBeNull();
  });
});
