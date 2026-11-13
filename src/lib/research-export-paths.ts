export function hasPrivateExportPath(value: unknown): boolean {
	if (typeof value === "string") {
		const text = value.replaceAll("\\", "/");
		return (
			/(?:^|[^a-z0-9])[a-z]:\//i.test(text) ||
			/(?:file|s3|gs|az):\/\//i.test(text) ||
			/^\/(?!\/)\S/.test(text) ||
			/(?:^|[\s"'=(])\/\/[^/\s]+\//.test(text) ||
			/(?:^|[\s"'=(])\/(?!\/)(?:[^/\s]+\/)+[^/\s]*/.test(text) ||
			/(?:^|[^a-z0-9])(?:exports|research)\/[a-f0-9]{64}\//i.test(text)
		);
	}
	if (Array.isArray(value)) return value.some(hasPrivateExportPath);
	if (value && typeof value === "object")
		return Object.entries(value).some(
			([key, nested]) =>
				hasPrivateExportPath(key) || hasPrivateExportPath(nested),
		);
	return false;
}
