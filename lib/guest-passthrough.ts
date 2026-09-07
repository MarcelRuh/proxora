export function isPciKey(key: string): boolean {
  return /^hostpci\d+$/.test(key);
}

export function isUsbKey(key: string): boolean {
  return /^usb\d+$/.test(key);
}

export function isCloudInitKey(key: string): boolean {
  return (
    key === "ciuser" ||
    key === "cipassword" ||
    key === "citype" ||
    key === "cicustom" ||
    key === "sshkeys" ||
    key === "nameserver" ||
    key === "searchdomain" ||
    /^ipconfig\d+$/.test(key)
  );
}
