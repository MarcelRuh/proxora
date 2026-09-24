/** Typed into an already open LXC shell. `-y` on autoremove so apt does not wait for a prompt. */
export const LXC_APT_UPGRADE_LINE = "apt update && apt upgrade -y && apt autoremove -y";

export const LXC_APT_UPGRADE_INPUT = `${LXC_APT_UPGRADE_LINE}\r`;
