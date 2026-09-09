/** Title for a control that is shown but not usable (RBAC or share ceiling). */
export function actionDeniedTitle(
  rbac: boolean,
  share: boolean,
  shareTitle: string,
  rbacTitle: string,
): string | undefined {
  if (!share) return shareTitle;
  if (!rbac) return rbacTitle;
  return undefined;
}
