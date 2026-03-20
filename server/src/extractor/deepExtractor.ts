import path from "node:path";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export type FieldSource = "body" | "params" | "query" | "headers" | "validation" | "response";

export interface Field {
  name: string;
  type?: string;
  source: FieldSource;
  required: boolean;
  lineNumber?: number;
}

export interface HandlerInfo {
  name: string;
  type: "inline" | "reference";
  lineNumber: number;
  foundIn?: string;
  extractedFrom?: string;
  requestFields: Field[];
  responseFields: Field[];
}

export interface ExtractedRoute {
  method: string;
  path: string;
  lineNumber: number;
  handlerType: "inline" | "reference" | "middleware_chain";
  handlers: HandlerInfo[];
  requestFields: Field[];
  responseFields: Field[];
  middlewares: string[];
  backtrackDepth: number;
  backtrackPath: string[];
  confidence: "high" | "medium" | "low";
}

export interface FileExtractionResult {
  filePath: string;
  routes: ExtractedRoute[];
}

interface ExtractedFunctionFields {
  requestFields: Field[];
  responseFields: Field[];
  extractedFrom: string;
  hasValidationSchema: boolean;
}

interface FunctionDefinition {
  body: string;
  startLine: number;
  extractedFrom: string;
}

interface BacktrackResult {
  found: boolean;
  filePath: string;
  depth: number;
  backtrackPath: string[];
  requestFields: Field[];
  responseFields: Field[];
  extractedFrom?: string;
  hasValidationSchema: boolean;
}

interface HandlerToken {
  raw: string;
  cleanName: string;
  isInline: boolean;
}

interface BacktrackCallbacks {
  onBacktrackStart?: (payload: { handler: string; fromFile: string; searchingIn: string }) => void;
  onBacktrackFound?: (payload: { handler: string; foundIn: string; depth: number }) => void;
  onFieldsExtracted?: (payload: {
    handler: string;
    requestFields: Field[];
    responseFields: Field[];
    extractedFrom: string;
  }) => void;
  onBacktrackFailed?: (payload: { handler: string; reason: string; fallback: string }) => void;
}

const METHOD_SET = new Set(["GET", "POST", "PUT", "DELETE", "PATCH"]);

const getLineNumber = (content: string, offset: number) => content.slice(0, offset).split(/\r?\n/).length;

const normalizeFilePath = (filePath: string) => filePath.replace(/\\/g, "/");

const splitTopLevel = (input: string) => {
  const parts: string[] = [];
  let start = 0;
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let quote: "'" | '"' | "`" | null = null;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const previous = input[index - 1];

    if (quote) {
      if (char === quote && previous !== "\\") {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }

    if (char === "(") {
      depthParen += 1;
      continue;
    }
    if (char === ")") {
      depthParen -= 1;
      continue;
    }
    if (char === "{") {
      depthBrace += 1;
      continue;
    }
    if (char === "}") {
      depthBrace -= 1;
      continue;
    }
    if (char === "[") {
      depthBracket += 1;
      continue;
    }
    if (char === "]") {
      depthBracket -= 1;
      continue;
    }

    if (char === "," && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
      parts.push(input.slice(start, index).trim());
      start = index + 1;
    }
  }

  const tail = input.slice(start).trim();
  if (tail) {
    parts.push(tail);
  }

  return parts;
};

const findBalancedClosingParen = (content: string, openParenIndex: number) => {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;

  for (let index = openParenIndex; index < content.length; index += 1) {
    const char = content[index];
    const previous = content[index - 1];

    if (quote) {
      if (char === quote && previous !== "\\") {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }

    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
};

const findBlockFromBrace = (content: string, openBraceIndex: number) => {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;

  for (let index = openBraceIndex; index < content.length; index += 1) {
    const char = content[index];
    const previous = content[index - 1];

    if (quote) {
      if (char === quote && previous !== "\\") {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          endBraceIndex: index,
          block: content.slice(openBraceIndex + 1, index),
        };
      }
    }
  }

  return null;
};

const tokenizeHandlers = (args: string[]) => {
  const handlerTokens: HandlerToken[] = [];
  args.forEach((arg) => {
    const trimmed = arg.trim();
    if (!trimmed) {
      return;
    }

    const isInline =
      trimmed.includes("=>") || trimmed.startsWith("function") || trimmed.startsWith("async function");
    const cleanName = trimmed.replace(/\s+/g, " ").trim();

    handlerTokens.push({
      raw: trimmed,
      cleanName,
      isInline,
    });
  });
  return handlerTokens;
};

const extractObjectKeys = (objectLike: string) => {
  return splitTopLevel(objectLike)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const keyMatch = segment.match(/^([A-Za-z_][\w$]*)\s*:/);
      if (keyMatch) {
        return { key: keyMatch[1], value: segment.slice(keyMatch[0].length).trim() };
      }
      const shorthand = segment.match(/^([A-Za-z_][\w$]*)$/);
      if (shorthand) {
        return { key: shorthand[1], value: shorthand[1] };
      }
      return null;
    })
    .filter((entry): entry is { key: string; value: string } => entry !== null);
};

const inferLiteralType = (value: string): string | undefined => {
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "true" || normalized === "false") {
    return "boolean";
  }
  if (/^[\d.]+$/.test(normalized)) {
    return "number";
  }
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    return "array";
  }
  if (normalized.startsWith("{") && normalized.endsWith("}")) {
    return "object";
  }
  if ((normalized.startsWith("\"") && normalized.endsWith("\"")) || (normalized.startsWith("'") && normalized.endsWith("'"))) {
    return "string";
  }
  if (normalized.includes("length")) {
    return "number";
  }
  return undefined;
};

const mergeFields = (...groups: Field[][]) => {
  const fieldMap = new Map<string, Field>();
  groups.flat().forEach((field) => {
    const key = `${field.source}:${field.name}`;
    const existing = fieldMap.get(key);

    if (!existing) {
      fieldMap.set(key, field);
      return;
    }

    fieldMap.set(key, {
      ...existing,
      ...field,
      required: existing.required || field.required,
      type: field.type ?? existing.type,
      lineNumber: existing.lineNumber ?? field.lineNumber,
    });
  });

  return Array.from(fieldMap.values());
};

export const extractFieldsFromFunctionBody = (functionBody: string, startLine: number): ExtractedFunctionFields => {
  const requestFields: Field[] = [];
  const responseFields: Field[] = [];
  const extractedFrom = new Set<string>();
  let hasValidationSchema = false;
  const lines = functionBody.split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNumber = startLine + index;

    const bodyPropertyRegex = /req\.body\.(\w+)/g;
    let bodyMatch = bodyPropertyRegex.exec(line);
    while (bodyMatch) {
      requestFields.push({
        name: bodyMatch[1],
        source: "body",
        required: true,
        lineNumber,
      });
      extractedFrom.add("req.body property access");
      bodyMatch = bodyPropertyRegex.exec(line);
    }

    const bodyBracketRegex = /req\.body\[['"](\w+)['"]\]/g;
    let bodyBracketMatch = bodyBracketRegex.exec(line);
    while (bodyBracketMatch) {
      requestFields.push({
        name: bodyBracketMatch[1],
        source: "body",
        required: true,
        lineNumber,
      });
      extractedFrom.add("req.body bracket access");
      bodyBracketMatch = bodyBracketRegex.exec(line);
    }

    const destructuredBodyMatch = line.match(/const\s*\{([^}]+)\}\s*=\s*req\.body/);
    if (destructuredBodyMatch) {
      splitTopLevel(destructuredBodyMatch[1]).forEach((part) => {
        const name = part.split(":")[0]?.trim().replace(/[?=].*$/, "");
        if (!name) {
          return;
        }

        requestFields.push({
          name,
          source: "body",
          required: !part.includes("=") && !name.endsWith("?"),
          lineNumber,
        });
      });
      extractedFrom.add("req.body destructuring");
    }

    const paramsRegex = /req\.params\.(\w+)/g;
    let paramsMatch = paramsRegex.exec(line);
    while (paramsMatch) {
      requestFields.push({
        name: paramsMatch[1],
        source: "params",
        required: true,
        lineNumber,
      });
      extractedFrom.add("req.params");
      paramsMatch = paramsRegex.exec(line);
    }

    const queryRegex = /req\.query\.(\w+)/g;
    let queryMatch = queryRegex.exec(line);
    while (queryMatch) {
      requestFields.push({
        name: queryMatch[1],
        source: "query",
        required: false,
        lineNumber,
      });
      extractedFrom.add("req.query");
      queryMatch = queryRegex.exec(line);
    }

    const headerRegex = /req\.headers\.(\w+)/g;
    let headerMatch = headerRegex.exec(line);
    while (headerMatch) {
      requestFields.push({
        name: headerMatch[1],
        source: "headers",
        required: false,
        lineNumber,
      });
      extractedFrom.add("req.headers");
      headerMatch = headerRegex.exec(line);
    }

    const joiRequiredRegex = /(\w+)\s*:\s*Joi\.(string|number|boolean|array)\(\).*?\.required\(\)/g;
    let joiRequiredMatch = joiRequiredRegex.exec(line);
    while (joiRequiredMatch) {
      requestFields.push({
        name: joiRequiredMatch[1],
        source: "validation",
        type: joiRequiredMatch[2],
        required: true,
        lineNumber,
      });
      hasValidationSchema = true;
      extractedFrom.add("Joi schema");
      joiRequiredMatch = joiRequiredRegex.exec(line);
    }

    const joiRegex = /(\w+)\s*:\s*Joi\.(string|number|boolean|array)\(\)(?!.*required\(\))/g;
    let joiMatch = joiRegex.exec(line);
    while (joiMatch) {
      requestFields.push({
        name: joiMatch[1],
        source: "validation",
        type: joiMatch[2],
        required: false,
        lineNumber,
      });
      hasValidationSchema = true;
      extractedFrom.add("Joi schema");
      joiMatch = joiRegex.exec(line);
    }

    const zodRequiredRegex = /(\w+)\s*:\s*z\.(string|number|boolean|array)\(\).*?\.min/g;
    let zodRequiredMatch = zodRequiredRegex.exec(line);
    while (zodRequiredMatch) {
      requestFields.push({
        name: zodRequiredMatch[1],
        source: "validation",
        type: zodRequiredMatch[2],
        required: true,
        lineNumber,
      });
      hasValidationSchema = true;
      extractedFrom.add("Zod schema");
      zodRequiredMatch = zodRequiredRegex.exec(line);
    }

    const zodRegex = /(\w+)\s*:\s*z\.(string|number|boolean|array)\(\)/g;
    let zodMatch = zodRegex.exec(line);
    while (zodMatch) {
      requestFields.push({
        name: zodMatch[1],
        source: "validation",
        type: zodMatch[2],
        required: false,
        lineNumber,
      });
      hasValidationSchema = true;
      extractedFrom.add("Zod schema");
      zodMatch = zodRegex.exec(line);
    }

    const expressValidatorRegex = /body\(["'](\w+)["']\)\.(\w+)/g;
    let validatorMatch = expressValidatorRegex.exec(line);
    while (validatorMatch) {
      requestFields.push({
        name: validatorMatch[1],
        source: "validation",
        type: validatorMatch[2] === "isEmail" ? "string" : undefined,
        required: true,
        lineNumber,
      });
      hasValidationSchema = true;
      extractedFrom.add("express-validator");
      validatorMatch = expressValidatorRegex.exec(line);
    }

    const jsonMatch = line.match(/res\.json\(\{([^}]+)\}\)/);
    if (jsonMatch) {
      extractObjectKeys(jsonMatch[1]).forEach(({ key, value }) => {
        responseFields.push({
          name: key,
          source: "response",
          type: inferLiteralType(value),
          required: true,
          lineNumber,
        });
      });
      extractedFrom.add("res.json");
    }

    const statusJsonMatch = line.match(/res\.status\(\d+\)\.json\(\{([^}]+)\}\)/);
    if (statusJsonMatch) {
      extractObjectKeys(statusJsonMatch[1]).forEach(({ key, value }) => {
        responseFields.push({
          name: key,
          source: "response",
          type: inferLiteralType(value),
          required: true,
          lineNumber,
        });
      });
      extractedFrom.add("res.status().json");
    }

    const returnObjectMatch = line.match(/return\s*\{([^}]+)\}/);
    if (returnObjectMatch) {
      extractObjectKeys(returnObjectMatch[1]).forEach(({ key, value }) => {
        responseFields.push({
          name: key,
          source: "response",
          type: inferLiteralType(value),
          required: true,
          lineNumber,
        });
      });
      extractedFrom.add("return object");
    }

    const tsInterfaceMatch = line.match(/interface\s+\w+\s*\{([^}]*)\}/);
    if (tsInterfaceMatch) {
      splitTopLevel(tsInterfaceMatch[1]).forEach((segment) => {
        const fieldMatch = segment.trim().match(/^(\w+)(\?)?\s*:\s*(\w+)/);
        if (!fieldMatch) {
          return;
        }

        requestFields.push({
          name: fieldMatch[1],
          source: "validation",
          type: fieldMatch[3],
          required: !fieldMatch[2],
          lineNumber,
        });
      });
      extractedFrom.add("TypeScript interface");
    }

    const mongooseSelectMatch = line.match(/\.select\(["']([^"']+)["']\)/);
    if (mongooseSelectMatch) {
      mongooseSelectMatch[1]
        .split(/\s+/)
        .map((name) => name.trim())
        .filter(Boolean)
        .forEach((name) => {
          responseFields.push({
            name,
            source: "response",
            required: true,
            lineNumber,
          });
        });
      extractedFrom.add("mongoose select");
    }

    const prismaCreateMatch = line.match(/prisma\.\w+\.create\(\{\s*data\s*:\s*\{([^}]*)\}/);
    if (prismaCreateMatch) {
      extractObjectKeys(prismaCreateMatch[1]).forEach(({ key }) => {
        requestFields.push({
          name: key,
          source: "body",
          required: true,
          lineNumber,
        });
      });
      extractedFrom.add("prisma create data");
    }
  });

  return {
    requestFields: mergeFields(requestFields),
    responseFields: mergeFields(responseFields),
    extractedFrom: Array.from(extractedFrom).join(" + ") || "function body patterns",
    hasValidationSchema,
  };
};

const findFunctionDefinition = (handlerName: string, fileContent: string): FunctionDefinition | null => {
  const escaped = handlerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const declarationRegex = new RegExp(`(?:async\\s+)?function\\s+${escaped}\\s*\\([^)]*\\)\\s*\\{`, "g");
  const declarationMatch = declarationRegex.exec(fileContent);
  if (declarationMatch) {
    const openBrace = fileContent.indexOf("{", declarationMatch.index);
    const block = findBlockFromBrace(fileContent, openBrace);
    if (block) {
      return {
        body: block.block,
        startLine: getLineNumber(fileContent, openBrace + 1),
        extractedFrom: "function declaration",
      };
    }
  }

  const arrowRegex = new RegExp(
    `(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*\\{`,
    "g"
  );
  const arrowMatch = arrowRegex.exec(fileContent);
  if (arrowMatch) {
    const openBrace = fileContent.indexOf("{", arrowMatch.index);
    const block = findBlockFromBrace(fileContent, openBrace);
    if (block) {
      return {
        body: block.block,
        startLine: getLineNumber(fileContent, openBrace + 1),
        extractedFrom: "arrow function",
      };
    }
  }

  const methodRegex = new RegExp(`(?:async\\s+)?${escaped}\\s*\\([^)]*\\)\\s*\\{`, "g");
  const methodMatch = methodRegex.exec(fileContent);
  if (methodMatch) {
    const openBrace = fileContent.indexOf("{", methodMatch.index);
    const block = findBlockFromBrace(fileContent, openBrace);
    if (block) {
      return {
        body: block.block,
        startLine: getLineNumber(fileContent, openBrace + 1),
        extractedFrom: "class/object method",
      };
    }
  }

  return null;
};

const findRelevantImports = (handlerName: string, fileContent: string) => {
  const escaped = handlerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const imports: string[] = [];

  const importNamedRegex = new RegExp(`import\\s*\\{[^}]*\\b${escaped}\\b[^}]*\\}\\s*from\\s*["'][^"']+["']`, "g");
  let match = importNamedRegex.exec(fileContent);
  while (match) {
    imports.push(match[0]);
    match = importNamedRegex.exec(fileContent);
  }

  const importDefaultRegex = new RegExp(`import\\s+${escaped}\\s+from\\s+["'][^"']+["']`, "g");
  match = importDefaultRegex.exec(fileContent);
  while (match) {
    imports.push(match[0]);
    match = importDefaultRegex.exec(fileContent);
  }

  const requireRegex = new RegExp(
    `const\\s*\\{[^}]*\\b${escaped}\\b[^}]*\\}\\s*=\\s*require\\(\\s*["'][^"']+["']\\s*\\)`,
    "g"
  );
  match = requireRegex.exec(fileContent);
  while (match) {
    imports.push(match[0]);
    match = requireRegex.exec(fileContent);
  }

  return imports;
};

export const resolveImportPath = (
  importStatement: string,
  currentFilePath: string,
  allProjectFiles?: Map<string, string>
) => {
  const fromMatch = importStatement.match(/from\s*["']([^"']+)["']/) ?? importStatement.match(/require\(\s*["']([^"']+)["']\s*\)/);
  if (!fromMatch) {
    return null;
  }

  const importPath = fromMatch[1];
  if (!importPath.startsWith(".")) {
    return null;
  }

  const currentNormalized = normalizeFilePath(currentFilePath);
  const basePath = path.posix.join(path.posix.dirname(currentNormalized), importPath);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.js`,
    `${basePath}.tsx`,
    `${basePath}.jsx`,
    `${basePath}.py`,
    `${basePath}.java`,
    `${basePath}.go`,
    path.posix.join(basePath, "index.ts"),
    path.posix.join(basePath, "index.js"),
  ];

  if (!allProjectFiles) {
    return normalizeFilePath(candidates[0]);
  }

  const normalizedCandidates = candidates.map(normalizeFilePath);
  return normalizedCandidates.find((candidate) => allProjectFiles.has(candidate)) ?? null;
};

export const backtrackHandler = (
  handlerName: string,
  currentFile: string,
  allProjectFiles: Map<string, string>,
  depth: number,
  callbacks?: BacktrackCallbacks,
  visited: Set<string> = new Set()
): BacktrackResult => {
  if (depth > 3) {
    callbacks?.onBacktrackFailed?.({
      handler: handlerName,
      reason: "Function not found after 3 levels",
      fallback: "Using route-level info only",
    });

    return {
      found: false,
      filePath: currentFile,
      depth,
      backtrackPath: [currentFile],
      requestFields: [],
      responseFields: [],
      hasValidationSchema: false,
    };
  }

  const normalizedCurrentFile = normalizeFilePath(currentFile);
  const visitKey = `${normalizedCurrentFile}:${handlerName}`;
  if (visited.has(visitKey)) {
    return {
      found: false,
      filePath: normalizedCurrentFile,
      depth,
      backtrackPath: [normalizedCurrentFile],
      requestFields: [],
      responseFields: [],
      hasValidationSchema: false,
    };
  }
  visited.add(visitKey);

  const currentContent = allProjectFiles.get(normalizedCurrentFile);
  if (!currentContent) {
    return {
      found: false,
      filePath: normalizedCurrentFile,
      depth,
      backtrackPath: [normalizedCurrentFile],
      requestFields: [],
      responseFields: [],
      hasValidationSchema: false,
    };
  }

  const definition = findFunctionDefinition(handlerName, currentContent);
  if (definition) {
    const extracted = extractFieldsFromFunctionBody(definition.body, definition.startLine);
    callbacks?.onBacktrackFound?.({
      handler: handlerName,
      foundIn: normalizedCurrentFile,
      depth,
    });
    callbacks?.onFieldsExtracted?.({
      handler: handlerName,
      requestFields: extracted.requestFields,
      responseFields: extracted.responseFields,
      extractedFrom: extracted.extractedFrom,
    });

    return {
      found: true,
      filePath: normalizedCurrentFile,
      depth,
      backtrackPath: [normalizedCurrentFile],
      requestFields: extracted.requestFields,
      responseFields: extracted.responseFields,
      extractedFrom: extracted.extractedFrom,
      hasValidationSchema: extracted.hasValidationSchema,
    };
  }

  const imports = findRelevantImports(handlerName, currentContent);
  for (const statement of imports) {
    const resolved = resolveImportPath(statement, normalizedCurrentFile, allProjectFiles);
    if (!resolved || resolved === normalizedCurrentFile) {
      continue;
    }

    callbacks?.onBacktrackStart?.({
      handler: handlerName,
      fromFile: normalizedCurrentFile,
      searchingIn: resolved,
    });

    const childResult = backtrackHandler(handlerName, resolved, allProjectFiles, depth + 1, callbacks, visited);
    if (childResult.found) {
      return {
        ...childResult,
        backtrackPath: [normalizedCurrentFile, ...childResult.backtrackPath],
      };
    }
  }

  if (depth === 0) {
    callbacks?.onBacktrackFailed?.({
      handler: handlerName,
      reason: "Function not found after 3 levels",
      fallback: "Using route-level info only",
    });
  }

  return {
    found: false,
    filePath: normalizedCurrentFile,
    depth,
    backtrackPath: [normalizedCurrentFile],
    requestFields: [],
    responseFields: [],
    hasValidationSchema: false,
  };
};

const inferConfidence = (
  routeDepth: number,
  hasValidationSchema: boolean,
  requestCount: number,
  responseCount: number
): "high" | "medium" | "low" => {
  if (routeDepth <= 1 && hasValidationSchema) {
    return "high";
  }

  if (routeDepth <= 2 && requestCount > 0) {
    return "medium";
  }

  if (routeDepth >= 3 || (requestCount === 0 && responseCount > 0) || !hasValidationSchema) {
    return "low";
  }

  return "medium";
};

const parseExpressRoutes = (fileContent: string) => {
  const routes: Array<{ method: HttpMethod; path: string; args: string[]; lineNumber: number }> = [];
  const routeRegex = /(app|router)\.(get|post|put|delete|patch)\s*\(/gi;

  let match = routeRegex.exec(fileContent);
  while (match) {
    const method = match[2].toUpperCase() as HttpMethod;
    if (!METHOD_SET.has(method)) {
      match = routeRegex.exec(fileContent);
      continue;
    }

    const openParen = fileContent.indexOf("(", match.index);
    const closeParen = findBalancedClosingParen(fileContent, openParen);
    if (closeParen === -1) {
      match = routeRegex.exec(fileContent);
      continue;
    }

    const inner = fileContent.slice(openParen + 1, closeParen);
    const args = splitTopLevel(inner);
    const routePathArg = args[0]?.trim();
    const pathMatch = routePathArg?.match(/^["'`]([^"'`]+)["'`]$/);
    if (!pathMatch) {
      match = routeRegex.exec(fileContent);
      continue;
    }

    routes.push({
      method,
      path: pathMatch[1],
      args: args.slice(1),
      lineNumber: getLineNumber(fileContent, match.index),
    });

    match = routeRegex.exec(fileContent);
  }

  return routes;
};

const parseNestDecorators = (fileContent: string) => {
  const routes: Array<{ method: HttpMethod; path: string; args: string[]; lineNumber: number }> = [];
  const nestRegex = /@(Get|Post|Put|Delete|Patch)\s*\(\s*["'`]([^"'`]*)["'`]\s*\)\s*[\r\n]+\s*(?:async\s+)?(\w+)\s*\(/g;
  let match = nestRegex.exec(fileContent);

  while (match) {
    routes.push({
      method: match[1].toUpperCase() as HttpMethod,
      path: match[2] || "/",
      args: [match[3]],
      lineNumber: getLineNumber(fileContent, match.index),
    });
    match = nestRegex.exec(fileContent);
  }

  return routes;
};

const parseFlaskRoutes = (fileContent: string) => {
  const routes: Array<{ method: HttpMethod; path: string; args: string[]; lineNumber: number }> = [];
  const flaskRegex = /@app\.route\(\s*["'`]([^"'`]+)["'`](?:\s*,\s*methods\s*=\s*\[([^\]]+)\])?\s*\)\s*[\r\n]+\s*def\s+(\w+)\s*\(/g;
  let match = flaskRegex.exec(fileContent);

  while (match) {
    const routePath = match[1];
    const methodsRaw = match[2];
    const handlerName = match[3];
    const routeLineNumber = getLineNumber(fileContent, match.index);
    const methods = methodsRaw
      ? methodsRaw
          .split(",")
          .map((token) => token.replace(/["'\s]/g, "").toUpperCase())
          .filter((token) => METHOD_SET.has(token))
      : ["GET"];

    methods.forEach((method) => {
      routes.push({
        method: method as HttpMethod,
        path: routePath,
        args: [handlerName],
        lineNumber: routeLineNumber,
      });
    });

    match = flaskRegex.exec(fileContent);
  }

  return routes;
};

const parseAllRoutes = (fileContent: string) => {
  return [...parseExpressRoutes(fileContent), ...parseNestDecorators(fileContent), ...parseFlaskRoutes(fileContent)];
};

// ---------------------- Next.js support ----------------------
export const isNextJsProject = (allFiles: string[]) => {
  return allFiles.some((f) => /(^|\/)next\.config\.(js|ts|mjs)$/.test(f));
};

export const inferApiPath = (filePath: string) => {
  const normalized = normalizeFilePath(filePath);

  // Pages router
  if (normalized.includes("/pages/api/")) {
    let p = normalized.split("/pages/api/")[1];
    // remove extension
    p = p.replace(/\.(ts|js|tsx|jsx)$/i, "");
    // convert [param] -> :param and [...slug] -> :slug*
    p = p
      .split("/")
      .map((segment) => {
        if (segment.startsWith("[...") && segment.endsWith("]")) {
          return `:${segment.slice(4, -1)}*`;
        }
        if (segment.startsWith("[") && segment.endsWith("]")) {
          return `:${segment.slice(1, -1)}`;
        }
        return segment;
      })
      .join("/");

    return `/api/${p}`.replace(/\/+/g, "/").replace(/\/$/g, "");
  }

  // App router
  if (normalized.includes("/app/") && /\/route\.(ts|js|tsx|jsx)$/.test(normalized)) {
    let p = normalized.split("/app/")[1];
    // remove /route.ts suffix
    p = p.replace(/\/route\.(ts|js|tsx|jsx)$/i, "");
    // strip group segments like (dashboard)
    p = p
      .split("/")
      .filter((s) => !/^\(.+\)$/.test(s))
      .map((segment) => {
        if (segment.startsWith("[...") && segment.endsWith("]")) {
          return `:${segment.slice(4, -1)}*`;
        }
        if (segment.startsWith("[") && segment.endsWith("]")) {
          return `:${segment.slice(1, -1)}`;
        }
        return segment;
      })
      .join("/");

    return `/${p}`.replace(/\/+/g, "/").replace(/\/$/g, "");
  }

  return "";
};

export const isNextJsApiFile = (filePath: string) => {
  const normalized = normalizeFilePath(filePath);
  if (normalized.includes("/pages/api/")) {
    return {
      isNextJs: true,
      routerType: "pages" as const,
      inferredPath: inferApiPath(normalized),
    };
  }

  if (normalized.includes("/app/") && /\/route\.(ts|js|tsx|jsx)$/.test(normalized)) {
    return {
      isNextJs: true,
      routerType: "app" as const,
      inferredPath: inferApiPath(normalized),
    };
  }

  return { isNextJs: false, routerType: null, inferredPath: "" };
};

const extractFieldsFromAppHandler = (functionBody: string, startLine: number): ExtractedFunctionFields => {
  const requestFields: Field[] = [];
  const responseFields: Field[] = [];
  const extractedFrom = new Set<string>();
  let hasValidationSchema = false;
  const lines = functionBody.split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNumber = startLine + index;

    const jsonBodyDestruct = line.match(/const\s*\{([^}]+)\}\s*=\s*await\s*request\.json\(\)/);
    if (jsonBodyDestruct) {
      splitTopLevel(jsonBodyDestruct[1]).forEach((part) => {
        const name = part.split(":")[0]?.trim().replace(/[?=].*$/, "");
        if (!name) return;
        requestFields.push({ name, source: "body", required: !part.includes("=") && !name.endsWith("?"), lineNumber });
      });
      extractedFrom.add("request.json destructuring");
    }

    const jsonBodyAssign = line.match(/const\s+(\w+)\s*=\s*await\s*request\.json\(\)/);
    if (jsonBodyAssign) {
      requestFields.push({ name: jsonBodyAssign[1], source: "body", required: true, lineNumber });
      extractedFrom.add("request.json assignment");
    }

    const paramsDestruct = line.match(/const\s*\{([^}]+)\}\s*=\s*params/);
    if (paramsDestruct) {
      splitTopLevel(paramsDestruct[1]).forEach((part) => {
        const name = part.split(":")[0]?.trim().replace(/[?=].*$/, "");
        if (!name) return;
        requestFields.push({ name, source: "params", required: true, lineNumber });
      });
      extractedFrom.add("params destructuring");
    }

    const paramAccess = line.match(/params\.(\w+)/g);
    if (paramAccess) {
      paramAccess.forEach((m) => {
        const n = m.split(".")[1];
        requestFields.push({ name: n, source: "params", required: true, lineNumber });
      });
      extractedFrom.add("params access");
    }

    const searchParamMatch = line.match(/request\.nextUrl\.searchParams\.get\(\s*['"](\w+)['"]\s*\)/);
    if (searchParamMatch) {
      requestFields.push({ name: searchParamMatch[1], source: "query", required: false, lineNumber });
      extractedFrom.add("searchParams.get");
    }

    const zodParseMatch = line.match(/\b(z\.[a-zA-Z0-9_]+\([^)]*\))|\.parse\(/);
    if (zodParseMatch) {
      // best effort: look backwards for schema declaration on previous lines
      hasValidationSchema = true;
      extractedFrom.add("Zod schema");
    }

    const nextResponseJson = line.match(/NextResponse\.json\(\s*\{([^}]*)\}\s*\)/);
    if (nextResponseJson) {
      extractObjectKeys(nextResponseJson[1]).forEach(({ key, value }) => {
        responseFields.push({ name: key, source: "response", type: inferLiteralType(value), required: true, lineNumber });
      });
      extractedFrom.add("NextResponse.json");
    }

    const responseJson = line.match(/Response\.json\(\s*\{([^}]*)\}\s*\)/);
    if (responseJson) {
      extractObjectKeys(responseJson[1]).forEach(({ key, value }) => {
        responseFields.push({ name: key, source: "response", type: inferLiteralType(value), required: true, lineNumber });
      });
      extractedFrom.add("Response.json");
    }
  });

  return { requestFields: mergeFields(requestFields), responseFields: mergeFields(responseFields), extractedFrom: Array.from(extractedFrom).join(" + ") || "app handler body", hasValidationSchema };
};

const extractFromNextPagesFile = (
  filePath: string,
  fileContent: string,
  allProjectFiles: Map<string, string>,
  callbacks?: BacktrackCallbacks
) => {
  const routes: ExtractedRoute[] = [];
  const normalized = normalizeFilePath(filePath);
  const inferredPath = inferApiPath(normalized) || "/api";

  // Pattern 1: default export handler with if (req.method === 'GET') { ... }
  const defaultExportRegex = /export\s+default\s+function\s+([\w$]+)?\s*\([^)]*\)\s*\{/g;
  const defMatch = defaultExportRegex.exec(fileContent);
  if (defMatch) {
    const openBrace = fileContent.indexOf("{", defMatch.index);
    const block = findBlockFromBrace(fileContent, openBrace);
    const body = block ? block.block : fileContent.slice(defMatch.index);
    // if checks
    const ifRegex = /if\s*\(\s*req\.method\s*===\s*['"]([A-Z]+)['"]\s*\)\s*\{/g;
    let match = ifRegex.exec(body);
    while (match) {
      const method = match[1];
      const open = body.indexOf("{", match.index);
      const blk = findBlockFromBrace(body, open);
      const funcBody = blk ? blk.block : "";
      const extracted = extractFieldsFromFunctionBody(funcBody, getLineNumber(fileContent, defMatch.index + match.index));
      routes.push({
        method,
        path: inferredPath,
        lineNumber: getLineNumber(fileContent, defMatch.index + match.index),
        handlerType: "inline",
        handlers: [
          {
            name: `export_default_${method}`,
            type: "inline",
            lineNumber: getLineNumber(fileContent, defMatch.index + match.index),
            requestFields: extracted.requestFields,
            responseFields: extracted.responseFields,
            extractedFrom: extracted.extractedFrom,
          },
        ],
        requestFields: extracted.requestFields,
        responseFields: extracted.responseFields,
        middlewares: [],
        backtrackDepth: 0,
        backtrackPath: [normalized],
        confidence: inferConfidence(0, extracted.hasValidationSchema, extracted.requestFields.length, extracted.responseFields.length),
      });

      match = ifRegex.exec(body);
    }

    // switch(req.method) pattern
    const switchRegex = /switch\s*\(\s*req\.method\s*\)\s*\{/g;
    const swMatch = switchRegex.exec(body);
    if (swMatch) {
      const open = body.indexOf("{", swMatch.index);
      const blk = findBlockFromBrace(body, open);
      const switchBlock = blk ? blk.block : "";
      const caseRegex = /case\s*['"]([A-Z]+)['"]\s*:/g;
      let cm = caseRegex.exec(switchBlock);
      while (cm) {
        const method = cm[1];
        // capture until next case or end
        const nextCase = caseRegex.exec(switchBlock);
        const start = cm.index + cm[0].length;
        const end = nextCase ? nextCase.index : switchBlock.length;
        const caseBody = switchBlock.slice(start, end);
        const extracted = extractFieldsFromFunctionBody(caseBody, getLineNumber(fileContent, defMatch.index + swMatch.index + start));
        routes.push({
          method,
          path: inferredPath,
          lineNumber: getLineNumber(fileContent, defMatch.index + cm.index),
          handlerType: "inline",
          handlers: [
            {
              name: `export_default_switch_${method}`,
              type: "inline",
              lineNumber: getLineNumber(fileContent, defMatch.index + cm.index),
              requestFields: extracted.requestFields,
              responseFields: extracted.responseFields,
              extractedFrom: extracted.extractedFrom,
            },
          ],
          requestFields: extracted.requestFields,
          responseFields: extracted.responseFields,
          middlewares: [],
          backtrackDepth: 0,
          backtrackPath: [normalized],
          confidence: inferConfidence(0, extracted.hasValidationSchema, extracted.requestFields.length, extracted.responseFields.length),
        });
        cm = nextCase;
      }
    }
  }

  // Pattern 3: handlers object
  const handlersObjRegex = /const\s+(\w+)\s*=\s*\{([\s\S]*?)\};/g;
  let hmatch = handlersObjRegex.exec(fileContent);
  while (hmatch) {
    const objBody = hmatch[2];
    const entries = extractObjectKeys(objBody);
    entries.forEach(({ key, value }) => {
      const method = key.toUpperCase();
      if (!METHOD_SET.has(method)) return;
      const handlerName = value.split(/[\s,\(]/)[0];
      const result = backtrackHandler(handlerName, normalized, allProjectFiles, 0, callbacks);
      routes.push({
        method,
        path: inferredPath,
        lineNumber: getLineNumber(fileContent, hmatch!.index),
        handlerType: "reference",
        handlers: [
          {
            name: handlerName,
            type: "reference",
            lineNumber: getLineNumber(fileContent, hmatch!.index),
            foundIn: result.filePath,
            requestFields: result.requestFields,
            responseFields: result.responseFields,
            extractedFrom: result.extractedFrom,
          },
        ],
        requestFields: result.requestFields,
        responseFields: result.responseFields,
        middlewares: [],
        backtrackDepth: result.depth,
        backtrackPath: result.backtrackPath,
        confidence: inferConfidence(result.depth, result.hasValidationSchema, result.requestFields.length, result.responseFields.length),
      });
    });
    hmatch = handlersObjRegex.exec(fileContent);
  }

  return routes;
};

const extractFromNextAppRouteFile = (
  filePath: string,
  fileContent: string,
  allProjectFiles: Map<string, string>,
  callbacks?: BacktrackCallbacks
) => {
  const normalized = normalizeFilePath(filePath);
  const inferredPath = inferApiPath(normalized) || "/api";
  const routes: ExtractedRoute[] = [];

  const exportFnRegex = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)\s*\([^)]*\)\s*\{/g;
  let match = exportFnRegex.exec(fileContent);
  while (match) {
    const method = match[1];
    const openBrace = fileContent.indexOf("{", match.index);
    const blk = findBlockFromBrace(fileContent, openBrace);
    const body = blk ? blk.block : "";
    const extracted = extractFieldsFromAppHandler(body, getLineNumber(fileContent, match.index));

    routes.push({
      method,
      path: inferredPath,
      lineNumber: getLineNumber(fileContent, match.index),
      handlerType: "inline",
      handlers: [
        {
          name: `export_${method}`,
          type: "inline",
          lineNumber: getLineNumber(fileContent, match.index),
          requestFields: extracted.requestFields,
          responseFields: extracted.responseFields,
          extractedFrom: extracted.extractedFrom,
        },
      ],
      requestFields: extracted.requestFields,
      responseFields: extracted.responseFields,
      middlewares: [],
      backtrackDepth: 0,
      backtrackPath: [normalized],
      confidence: inferConfidence(0, extracted.hasValidationSchema, extracted.requestFields.length, extracted.responseFields.length),
    });

    match = exportFnRegex.exec(fileContent);
  }

  return routes;
};

// -------------------- end Next.js support --------------------

export const extractFromFile = (
  filePath: string,
  fileContent: string,
  allProjectFiles: Map<string, string>,
  callbacks?: BacktrackCallbacks
): FileExtractionResult => {
  const normalizedFilePath = normalizeFilePath(filePath);
  if (!allProjectFiles.has(normalizedFilePath)) {
    allProjectFiles.set(normalizedFilePath, fileContent);
  }

  // If this file matches Next.js API patterns, use Next.js specific extractor
  const nextCheck = isNextJsApiFile(normalizedFilePath);
  if (nextCheck.isNextJs) {
    if (nextCheck.routerType === "pages") {
      const routes = extractFromNextPagesFile(normalizedFilePath, fileContent, allProjectFiles, callbacks);
      return { filePath: normalizedFilePath, routes };
    }

    if (nextCheck.routerType === "app") {
      const routes = extractFromNextAppRouteFile(normalizedFilePath, fileContent, allProjectFiles, callbacks);
      return { filePath: normalizedFilePath, routes };
    }
  }

  const routes = parseAllRoutes(fileContent).map((route) => {
    const handlerTokens = tokenizeHandlers(route.args);
    const handlerInfo: HandlerInfo[] = [];
    const allRequestFields: Field[] = [];
    const allResponseFields: Field[] = [];
    const backtrackPath = new Set<string>([normalizedFilePath]);
    let deepest = 0;
    let hasValidationSchema = false;

    handlerTokens.forEach((token, index) => {
      if (token.isInline) {
        const openBraceIndex = token.raw.indexOf("{");
        const closeBraceIndex = token.raw.lastIndexOf("}");
        const body =
          openBraceIndex >= 0 && closeBraceIndex > openBraceIndex
            ? token.raw.slice(openBraceIndex + 1, closeBraceIndex)
            : token.raw;

        const extracted = extractFieldsFromFunctionBody(body, route.lineNumber);
        allRequestFields.push(...extracted.requestFields);
        allResponseFields.push(...extracted.responseFields);
        hasValidationSchema = hasValidationSchema || extracted.hasValidationSchema;

        handlerInfo.push({
          name: `inline_${index + 1}`,
          type: "inline",
          lineNumber: route.lineNumber,
          requestFields: extracted.requestFields,
          responseFields: extracted.responseFields,
          extractedFrom: extracted.extractedFrom,
        });
        return;
      }

      const handlerName = token.cleanName.split(/[.(]/)[0].trim();
      const result = backtrackHandler(handlerName, normalizedFilePath, allProjectFiles, 0, callbacks);
      deepest = Math.max(deepest, result.depth);
      result.backtrackPath.forEach((pathItem) => backtrackPath.add(pathItem));
      allRequestFields.push(...result.requestFields);
      allResponseFields.push(...result.responseFields);
      hasValidationSchema = hasValidationSchema || result.hasValidationSchema;

      handlerInfo.push({
        name: handlerName,
        type: "reference",
        lineNumber: route.lineNumber,
        foundIn: result.filePath,
        requestFields: result.requestFields,
        responseFields: result.responseFields,
        extractedFrom: result.extractedFrom,
      });
    });

    const middlewares =
      handlerTokens.length > 1
        ? handlerTokens
            .slice(0, -1)
            .filter((token) => !token.isInline)
            .map((token) => token.cleanName.split(/[.(]/)[0].trim())
        : [];

    const requestFields = mergeFields(allRequestFields);
    const responseFields = mergeFields(allResponseFields);
    const handlerType: ExtractedRoute["handlerType"] =
      handlerTokens.length > 1
        ? "middleware_chain"
        : handlerTokens[0]?.isInline
          ? "inline"
          : "reference";

    return {
      method: route.method,
      path: route.path,
      lineNumber: route.lineNumber,
      handlerType,
      handlers: handlerInfo,
      requestFields,
      responseFields,
      middlewares,
      backtrackDepth: deepest,
      backtrackPath: Array.from(backtrackPath),
      confidence: inferConfidence(deepest, hasValidationSchema, requestFields.length, responseFields.length),
    } as ExtractedRoute;
  });

  return {
    filePath: normalizedFilePath,
    routes,
  };
};

export default {
  extractFromFile,
  backtrackHandler,
  extractFieldsFromFunctionBody,
  resolveImportPath,
};
