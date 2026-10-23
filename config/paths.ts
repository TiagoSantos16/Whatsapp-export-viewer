export function deploymentPaths(value = "/") {
  const base =
    "/" +
    value.replace(/^\/+|\/+$/g, "") +
    (value.replace(/\//g, "") ? "/" : "");
  if (!/^\/(?:[a-z0-9._~%\-]+\/)*$/i.test(base))
    throw Error(
      "BASE_PATH must be an absolute directory path, such as /chat-archive/.",
    );
  return { base, app: base + "app/" };
}
