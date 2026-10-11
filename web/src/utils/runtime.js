export function buildRuntimeCommand(
  fileName,
  languageId,
  workingDirectory = "/sdcard",
) {
  let safeName = String(fileName || "script.txt").replace(/\\/g, "/");
  safeName = safeName.replace(/^\/storage\/emulated\/0(?=\/|$)/i, "/sdcard");
  if (!safeName || safeName === "/") safeName = "script.txt";
  const safeDir = String(workingDirectory || "/sdcard")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  const filePath = safeName.startsWith("/")
    ? safeName
    : `${safeDir}/${safeName}`;

  const baseCommand = (() => {
    switch (String(languageId || "").toLowerCase()) {
      case "javascript":
      case "js":
        return `node "${filePath}"`;
      case "python":
      case "py":
        return `python3 "${filePath}"`;
      case "bash":
      case "shell":
      case "sh":
        return `bash "${filePath}"`;
      case "java":
        return `javac "${filePath}" && java "${filePath.replace(/\.java$/, "")}"`;
      default:
        return `sh "${filePath}"`;
    }
  })();

  return `unset PREFIX; ${baseCommand}`;
}

export function parseRunResult(rawResponse) {
  const response = String(rawResponse ?? "").trim();
  if (!response) {
    return {
      success: false,
      exitCode: -1,
      output: "",
      error: "Sem resposta do serviço LunusDroid.",
    };
  }

  try {
    const result = JSON.parse(response);
    if (!result || typeof result !== "object") {
      throw new TypeError("Resposta inválida.");
    }

    return {
      success: Boolean(result.success),
      exitCode: Number.isFinite(Number(result.exitCode))
        ? Number(result.exitCode)
        : -1,
      output: String(result.output ?? ""),
      error: String(result.error ?? ""),
    };
  } catch (error) {
    return { success: false, exitCode: -1, output: "", error: response };
  }
}
