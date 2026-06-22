export function extractCommonJsonSchema(jsonSchema: unknown): unknown {
  const record = jsonSchema && typeof jsonSchema === "object" ? jsonSchema as Record<string, unknown> : {};
  const schema = record.schema && typeof record.schema === "object" ? record.schema : jsonSchema;
  return schema ?? {};
}

