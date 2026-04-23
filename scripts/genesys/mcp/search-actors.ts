import * as fs from 'fs';
import * as path from 'path';

import * as ENGINE from '@gnsx/genesys.js';
import { ModuleKind, ModuleResolutionKind, Project, ScriptTarget } from 'ts-morph';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { StorageProvider } from '../storageProvider.js';

import { isSubclass } from './utils.js';


import type { ClassDeclaration, ParameterDeclaration, SourceFile} from 'ts-morph';

const PropertyInfoSchema: z.ZodType<{
  type: string;
  description?: string;
  canPopulateFromJson?: boolean;
  optional: boolean;
  properties?: Record<string, any>;
}> = z.object({
  type: z.string().describe('Type of the property, e.g. "string", "number", "THREE.Vector3", "object"'),
  description: z.string().optional().describe('Description of the property, extracted from JSDoc if available'),
  canPopulateFromJson: z.boolean().optional().describe('Whether this property can be populated from JSON values'),
  optional: z.boolean().describe('Whether the property is optional or not'),
  properties: z.lazy(() => z.record(PropertyInfoSchema)).optional().describe('If the property is an object, this contains its properties recursively'),
}).describe('Represents information about a property within a parameter');

export type PropertyInfo = z.infer<typeof PropertyInfoSchema>;

const ParameterInfoSchema: z.ZodType<{
  paramName: string;
  type: string;
  description?: string;
  canPopulateFromJson?: boolean;
  properties?: Record<string, PropertyInfo>;
  optional: boolean;
}> = z.object({
  paramName: z.string().describe('Name of the constructor parameter'),
  type: z.string().describe('Type of the parameter, e.g. "string", "number", "THREE.Vector3", "object"'),
  description: z.string().optional().describe('Description of the parameter, extracted from JSDoc if available'),
  canPopulateFromJson: z.boolean().optional().describe('Whether this parameter can be populated from JSON values'),
  properties: z.record(PropertyInfoSchema).optional().describe('If the parameter is an object, this contains its properties recursively'),
  optional: z.boolean().describe('Whether the parameter is optional or not'),
}).describe('Represents information about a constructor parameter');

export type ParameterInfo = z.infer<typeof ParameterInfoSchema>;

const ConstructorParametersSchema = z.array(ParameterInfoSchema).describe('Constructor parameters as an array preserving order');

export type ConstructorParameters = z.infer<typeof ConstructorParametersSchema>;

const ActorInfoSchema = z.object({
  className: z.string().describe('Fully qualified name of the class including ENGINE. or GAME. prefix'),
  filePath: z.string().describe('Path to the source file containing this class'),
  baseClasses: z.array(z.string()).describe('Array of parent class names this actor extends from'),
  constructorParams: ConstructorParametersSchema.optional().describe('Array of constructor parameters in declaration order'),
  canPopulateFromJson: z.boolean().optional().describe('Whether this actor can be instantiated purely from JSON data (all required parameters are JSON-serializable)'),
  description: z.string().optional().describe('Human-readable description of the actor class and its purpose')
}).describe('Complete information about an actor class');

export type ActorInfo = z.infer<typeof ActorInfoSchema>;

export const ThreeVector3Schema = z.object({
  type: z.literal('THREE.Vector3').describe('The type of the object, must be "THREE.Vector3"'),
  x: z.number().describe('The x component of the vector'),
  y: z.number().describe('The y component of the vector'),
  z: z.number().describe('The z component of the vector'),
}).describe('Represents a THREE.Vector3 object');

export const ThreeEulerSchema = z.object({
  type: z.literal('THREE.Euler').describe('The type of the object, must be "THREE.Euler"'),
  x: z.number().describe('The x component of the euler, pitch, in radians'),
  y: z.number().describe('The y component of the euler, yaw, in radians'),
  z: z.number().describe('The z component of the euler, roll, in radians'),
}).describe('Represents a THREE.Euler object');


/**
 * Result of searching for actors
 */
export interface ActorsSearchResult {
  metadataDescription: Record<string, any>;
  actors: Record<string, ActorInfo>; // className -> ActorInfo
}

/**
 * Configuration options for actor search
 */
export interface ActorSearchOptions {
  classesToSearch?: string[];  // Specific classes to search for, if empty all actors will be returned
  includeConstructorParams?: boolean;  // Whether to include constructor parameters in the result
}

/**
 * Creates metadata description for the search results by recursively extracting descriptions from Zod schemas
 */
function createMetadataDescription(): Record<string, any> {
  function extractSchemaDescriptions(schema: any): any {
    // Handle missing or invalid schema
    if (!schema) return {};

    const result: Record<string, any> = {};

    // Add schema's own description if present
    if (schema.description) {
      result.description = schema.description;
    }

    // Handle object with properties
    if (schema.type === 'object' && schema.properties) {
      result.fields = {};
      for (const [key, prop] of Object.entries<any>(schema.properties)) {
        result.fields[key] = extractSchemaDescriptions(prop);
      }
    }

    // Handle arrays
    if (schema.type === 'array' && schema.items) {
      const items = extractSchemaDescriptions(schema.items);
      if (items && Object.keys(items).length > 0) {
        result.items = items;
      }
    }

    // Handle references
    if (schema.$ref && schema.$ref.startsWith('#/definitions/')) {
      const refName = schema.$ref.replace('#/definitions/', '');
      const refSchema = definitions[refName];
      if (refSchema) {
        Object.assign(result, extractSchemaDescriptions(refSchema));
      }
    }

    // Handle anyOf/oneOf (union types)
    if (schema.anyOf ?? schema.oneOf) {
      const variants = schema.anyOf ?? schema.oneOf;
      result.variants = variants.map((variant: any) => extractSchemaDescriptions(variant));
    }

    return result;
  }

  // Convert Zod schema to JSON schema
  const actorInfoSchema = zodToJsonSchema(ActorInfoSchema, 'ActorInfoSchema');

  // Get all definitions from the schema
  const definitions = (actorInfoSchema as any).definitions ?? {};

  const result = extractSchemaDescriptions(actorInfoSchema).fields;

  const vector3Schema = zodToJsonSchema(ThreeVector3Schema, 'ThreeVector3Schema');
  const eulerSchema = zodToJsonSchema(ThreeEulerSchema, 'ThreeEulerSchema');
  const vector3Example: z.infer<typeof ThreeVector3Schema> = {
    type: 'THREE.Vector3',
    x: 1,
    y: 2,
    z: 3,
  };
  const eulerExample: z.infer<typeof ThreeEulerSchema> = {
    type: 'THREE.Euler',
    x: 0,
    y: 1.57,
    z: -3.14,
  };
  result.specialTypes = {
    description: 'Here shows how some special types should be populated from JSON values',
    'THREE.Vector3': { ...extractSchemaDescriptions(vector3Schema.definitions?.ThreeVector3Schema ?? {}), example: vector3Example },
    'THREE.Euler': { ...extractSchemaDescriptions(eulerSchema.definitions?.ThreeEulerSchema ?? {}), example: eulerExample },
  };
  return result;
}

/**
 * Creates a ts-morph project with proper TypeScript configuration
 */
function createTsMorphProject(storageProvider: StorageProvider): Project {
  try {
    // Try to use the project's tsconfig.json
    const tsconfigPath = storageProvider.getFullPath('@project/tsconfig.json');

    const project = new Project({
      tsConfigFilePath: fs.existsSync(tsconfigPath) ? tsconfigPath : undefined,
      useInMemoryFileSystem: false,
      skipAddingFilesFromTsConfig: true,
    });

    console.log('✅ ts-morph project created successfully');
    return project;
  } catch (error) {
    console.warn('⚠️  Failed to create ts-morph project with tsconfig, using default configuration');
    console.warn('Error:', error instanceof Error ? error.message : String(error));

    // Fallback to basic configuration
    return new Project({
      useInMemoryFileSystem: false,
      compilerOptions: {
        target: ScriptTarget.ES2020,
        module: ModuleKind.ESNext,
        moduleResolution: ModuleResolutionKind.Node10,
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
      }
    });
  }
}

/**
 * Extracts enum values from a union type
 */
function extractEnumValues(type: any): string[] {
  try {
    if (type.isUnion()) {
      const enumValues: string[] = [];
      const unionTypes = type.getUnionTypes();

      for (const unionType of unionTypes) {
        if (unionType.isStringLiteral()) {
          const literalValue = unionType.getLiteralValue();
          if (typeof literalValue === 'string') {
            enumValues.push(literalValue);
          }
        } else if (unionType.isNumberLiteral()) {
          const literalValue = unionType.getLiteralValue();
          if (typeof literalValue === 'number') {
            enumValues.push(literalValue.toString());
          }
        }
      }

      return enumValues;
    }

    return [];
  } catch (error) {
    return [];
  }
}

/**
 * Extracts properties from an object type using ts-morph Type analysis
 */
function extractObjectProperties(type: any, visited: Set<string> = new Set()): Record<string, PropertyInfo> {
  try {
    const properties: Record<string, PropertyInfo> = {};
    const typeString = type.getText();

    // Prevent infinite recursion
    if (visited.has(typeString)) {
      return {};
    }
    visited.add(typeString);

    // Handle union types - extract properties from the non-undefined part
    if (type.isUnion()) {
      const unionTypes = type.getUnionTypes();
      for (const unionType of unionTypes) {
        // Skip undefined types
        if (unionType.isUndefined()) {
          continue;
        }
        // If we find an object type in the union, extract its properties
        const unionProperties = unionType.getApparentProperties();
        if (unionProperties && unionProperties.length > 0) {
          return extractObjectProperties(unionType, visited);
        }
      }
    }

    // Get all properties of the type (includes inherited properties)
    const typeProperties = type.getApparentProperties();

    for (const prop of typeProperties) {
      const propName = prop.getName();

      // Skip internal/private properties
      if (propName.startsWith('_') || propName.startsWith('__')) {
        continue;
      }

      const propDeclaration = prop.getValueDeclaration();
      if (!propDeclaration) continue;

      // Get property type
      const propType = prop.getTypeAtLocation(propDeclaration);
      const propTypeText = propType.getText(propDeclaration);

      // Try to extract JSDoc description
      let description: string | undefined;
      if (propDeclaration && 'getJsDocs' in propDeclaration) {
        const jsDocs = (propDeclaration as any).getJsDocs();
        if (jsDocs.length > 0) {
          description = jsDocs[0].getDescription();
        }
      }

      // Check if this is an enum/union type
      const enumValues = extractEnumValues(propType);
      let finalType = normalizeTypeText(propTypeText);

      // Add enum values to the cleaned description
      let finalDescription = description;
      if (enumValues.length > 0) {
        const enumDescription = `Possible values: ${enumValues.join(', ')}`;
        finalDescription = finalDescription ? `${finalDescription}. ${enumDescription}` : enumDescription;
      }

      // Determine if this type can be populated from JSON
      const jsonSerializable = canPopulateFromJson(propTypeText, propType);

      // Determine if this property has nested properties
      const paramInfo: PropertyInfo = {
        type: shouldTreatAsObject(propTypeText, propType) ? 'object' : finalType,
        description: finalDescription,
        canPopulateFromJson: jsonSerializable,
        optional: prop.isOptional()
      };

      // If it's an object type, recursively extract properties
      if (shouldTreatAsObject(propTypeText, propType)) {
        paramInfo.properties = extractObjectProperties(propType, visited);
      }

      properties[propName] = paramInfo;
    }

    return properties;
  } catch (error) {
    console.warn('Failed to extract object properties:', error instanceof Error ? error.message : String(error));
    return {};
  }
}

/**
 * Extracts properties from an options object type using ts-morph Type analysis
 */
function extractOptionsProperties(param: ParameterDeclaration): Record<string, PropertyInfo> {
  try {
    const type = param.getType();
    return extractObjectProperties(type);
  } catch (error) {
    console.warn(`Failed to extract properties for parameter ${param.getName()}:`, error instanceof Error ? error.message : String(error));
    return {};
  }
}

/**
 * Determines if a type should be treated as an object with properties
 */
function shouldTreatAsObject(typeText: string, tsType?: any): boolean {
  // Skip primitive types (but not when they appear in object literals)
  if (!typeText.includes('{') && ['string', 'number', 'boolean'].some(t => typeText === t || typeText === `${t} | undefined`)) {
    return false;
  }

  // Skip THREE.Vector3 and THREE.Euler - these are handled specially
  if (typeText.includes('Vector3') || typeText.includes('Euler')) return false;

  // Skip ENGINE.* and GAME.* classes - these are complex types
  if (typeText.includes('ENGINE.') || typeText.includes('GAME.')) return false;

  // Skip function types
  if (typeText.includes('=>') || typeText.includes('Function') || typeText.includes('()')) return false;

  // If we have TypeScript type information, use it
  if (tsType) {
    try {
      // Handle union types - check if any union member is an interface-like type
      if (tsType.isUnion()) {
        const unionTypes = tsType.getUnionTypes();
        for (const unionType of unionTypes) {
          // Skip undefined types
          if (unionType.isUndefined()) {
            continue;
          }
          // Check if this union member is an interface-like type
          if (isInterfaceLikeType(unionType)) {
            return true;
          }
        }
      }

      // Check if the type is an interface-like type
      if (isInterfaceLikeType(tsType)) {
        return true;
      }
    } catch (error) {
      // If we can't get properties, fall back to string matching
    }
  }

  // Treat object literals as objects (inline interfaces)
  if (typeText.includes('{')) {
    return true;
  }

  return false;
}

/**
 * Checks if a type is interface-like (has properties but is not a function or complex class)
 */
function isInterfaceLikeType(type: any): boolean {
  try {
    const properties = type.getApparentProperties();
    if (!properties || properties.length === 0) {
      return false;
    }

    // Check if any property is a function - if so, this might be a class or complex type
    for (const prop of properties) {
      try {
        const propType = prop.getTypeAtLocation(prop.getValueDeclaration());
        const propTypeText = propType.getText();

        // If we find function properties, this is likely a class or complex type
        if (propTypeText.includes('=>') || propTypeText.includes('Function') || propTypeText.includes('()')) {
          // Allow if it's clearly a callback/event handler (common in options)
          const propName = prop.getName();
          if (propName.toLowerCase().includes('callback') ||
              propName.toLowerCase().includes('handler') ||
              propName.toLowerCase().includes('listener') ||
              propName.toLowerCase().startsWith('on')) {
            continue; // Allow these function properties
          }
          return false; // Skip types with non-callback function properties
        }
      } catch (error) {
        // If we can't analyze a property, continue
        continue;
      }
    }

    return true; // It has properties and they're not complex functions
  } catch (error) {
    return false;
  }
}

/**
 * Determines if a type can be populated from JSON values
 */
function canPopulateFromJson(typeText: string, tsType?: any, visited: Set<string> = new Set()): boolean {
  // Handle undefined types - they can be omitted in JSON
  if (typeText.includes('undefined')) {
    // Extract the non-undefined part
    const nonUndefPart = typeText.replace(/\s*\|\s*undefined/g, '').trim();
    if (nonUndefPart) {
      // Create a new visited set for the non-undefined part to avoid false recursion detection
      const newVisited = new Set(visited);
      newVisited.delete(typeText); // Remove the original union type
      return canPopulateFromJson(nonUndefPart, tsType, newVisited);
    }
    return true; // Pure undefined can be omitted
  }

  // Prevent infinite recursion
  if (visited.has(typeText)) {
    return false;
  }
  visited.add(typeText);

  // Primitive types can be populated
  if (['string', 'number', 'boolean'].some(t => typeText === t || typeText.startsWith(t))) {
    return true;
  }

  // THREE.Vector3 and THREE.Euler can be populated as [x,y,z] arrays
  if (typeText.includes('Vector3') || typeText.includes('Euler')) {
    return true;
  }

  // ENGINE.* and GAME.* classes cannot be populated (complex runtime objects)
  if (typeText.includes('ENGINE.') || typeText.includes('GAME.')) {
    return false;
  }

  // Function types cannot be populated
  if (typeText.includes('=>') || typeText.includes('Function') || typeText.includes('()')) {
    return false;
  }

  // Object literals can be populated (inline object types)
  if (typeText.includes('{')) {
    return true; // Inline object types can be populated
  }

  // Array types can be populated if their element type can be populated
  if (typeText.includes('[]')) {
    const elementType = typeText.replace('[]', '').trim();
    return canPopulateFromJson(elementType, undefined, visited);
  }

  // Check TypeScript type information
  if (tsType) {
    try {
      const enumValues = extractEnumValues(tsType);
      if (enumValues.length > 0) {
        return true; // Enums can be populated
      }

      // Handle union types
      if (tsType.isUnion()) {
        const unionTypes = tsType.getUnionTypes();
        // Check if any non-undefined union member can be populated
        for (const unionType of unionTypes) {
          if (unionType.isUndefined()) {
            continue;
          }
          const unionTypeText = unionType.getText();
          if (canPopulateFromJson(unionTypeText, unionType, visited)) {
            return true;
          }
        }
        return false;
      }

      // Check if this is an object type with properties
      if (isInterfaceLikeType(tsType)) {
        return canObjectBePopulatedFromJson(tsType, visited);
      }
    } catch (error) {
      // If type analysis fails, fall back to string matching
    }
  }

  // Default to false for unknown types
  return false;
}

/**
 * Checks if an object type can be populated from JSON by checking if all required properties can be populated
 */
function canObjectBePopulatedFromJson(tsType: any, visited: Set<string> = new Set()): boolean {
  try {
    const properties = tsType.getApparentProperties();
    if (!properties || properties.length === 0) {
      return true; // Empty object can be populated
    }

    // Check all properties
    for (const prop of properties) {
      const propName = prop.getName();

      // Skip internal/private properties
      if (propName.startsWith('_') || propName.startsWith('__')) {
        continue;
      }

      const propDeclaration = prop.getValueDeclaration();
      if (!propDeclaration) continue;

      // Check if property is required
      const isOptional = prop.isOptional();

      // If it's required, it must be populatable
      if (!isOptional) {
        const propType = prop.getTypeAtLocation(propDeclaration);
        const propTypeText = propType.getText(propDeclaration);

        if (!canPopulateFromJson(propTypeText, propType, visited)) {
          return false; // Required property cannot be populated
        }
      }
      // Note: We don't need to check optional properties - they can be omitted
    }

    return true; // All required properties can be populated (or all properties are optional)
  } catch (error) {
    return false; // If analysis fails, assume it cannot be populated
  }
}

/**
 * Normalizes type text for display
 */
function normalizeTypeText(typeText: string): string {
  if (typeText.includes('Vector3')) return 'THREE.Vector3';
  if (typeText.includes('Euler')) return 'THREE.Euler';
  return typeText;
}

/**
 * Extracts JSDoc description for a parameter
 */
function extractParamJSDoc(param: ParameterDeclaration): string | undefined {
  // Get JSDoc tags from the parent constructor
  const constructor = param.getParent();
  if (!constructor || !('getJsDocs' in constructor)) return undefined;

  try {
    const jsDocs = (constructor as any).getJsDocs();
    if (!jsDocs || jsDocs.length === 0) return undefined;

    const paramName = param.getName();
    for (const jsDoc of jsDocs) {
      const tags = jsDoc.getTags();
      for (const tag of tags) {
        if (tag.getTagName() === 'param' && tag.getComment()?.includes(paramName)) {
          return tag.getComment();
        }
      }
    }
  } catch (error) {
    // If JSDoc extraction fails, silently continue
    return undefined;
  }

  return undefined;
}

/**
 * Analyzes a constructor parameter to extract detailed information
 */
function analyzeParameter(param: ParameterDeclaration): ParameterInfo {
  const tsType = param.getType();
  const type = tsType.getText(param);
  const normalizedType = normalizeTypeText(type);
  const paramName = param.getName();

  // Extract JSDoc description
  let description = extractParamJSDoc(param);

  // Check if this is an enum/union type
  const enumValues = extractEnumValues(tsType);

  // Add enum values to the cleaned description
  let finalDescription = description;
  if (enumValues.length > 0) {
    const enumDescription = `Possible values: ${enumValues.join(', ')}`;
    finalDescription = finalDescription ? `${finalDescription}. ${enumDescription}` : enumDescription;
  }

  // Determine if this type can be populated from JSON
  const jsonSerializable = canPopulateFromJson(type, tsType);

  const paramInfo: ParameterInfo = {
    paramName,
    type: shouldTreatAsObject(type, tsType) ? 'object' : normalizedType,
    description: finalDescription,
    canPopulateFromJson: jsonSerializable,
    optional: param.isOptional()
  };

  // Extract properties if this is an options object
  if (shouldTreatAsObject(type, tsType)) {
    paramInfo.properties = extractOptionsProperties(param);
  }

  return paramInfo;
}

/**
 * Determines if an actor class can be populated from JSON based on its constructor parameters
 */
function canActorBePopulatedFromJson(constructorParams: ConstructorParameters): boolean {
  // If there are no constructor parameters, it can be populated
  if (!constructorParams || constructorParams.length === 0) {
    return true;
  }

  // Check each parameter
  for (const paramInfo of constructorParams) {
    // If any required parameter cannot be populated from JSON, the actor cannot be populated
    if (paramInfo.canPopulateFromJson === false) {
      // Check if this parameter is optional (has undefined in type)
      const isOptional = paramInfo.type.includes('undefined');
      if (!isOptional) {
        return false; // Required parameter cannot be populated from JSON
      }
    }
  }

  return true; // All required parameters can be populated from JSON
}

/**
 * Extracts constructor parameters from a class declaration
 */
function extractConstructorParams(classDecl: ClassDeclaration): ConstructorParameters {
  const constructors = classDecl.getConstructors();
  if (constructors.length === 0) return [];

  // Take the first constructor (could be enhanced to handle overloads)
  const constructor = constructors[0];

  return constructor.getParameters().map(param => analyzeParameter(param));
}

/**
 * Analyzes a class declaration to extract actor information
 */
function analyzeActorClassBasics(
  sourceFile: SourceFile,
  classDeclaration: ClassDeclaration,
  classPrefix: ENGINE.Prefix
): ActorInfo | null {
  const className = classDeclaration.getName();
  if (!className) return null;

  const prefixedClassName = classPrefix + className;
  const classConstructor = ENGINE.ClassRegistry.getRegistry().get(prefixedClassName);
  if (!isSubclass(classConstructor, ENGINE.Actor)) return null;

  // Extract basic information
  const filePath = sourceFile.getFilePath();
  const heritage = classDeclaration.getExtends();
  const parentClassName = heritage?.getExpression().getText() ?? '';

  // For now, create a simple base classes array
  const baseClasses: string[] = [];
  if (parentClassName) {
    baseClasses.push(parentClassName);
  }

  // Extract JSDoc description if available
  const jsDocs = classDeclaration.getJsDocs();
  const description = jsDocs.length > 0 ? jsDocs[0].getDescription() : undefined;

  // Extract constructor parameters
  // const constructorParams = extractConstructorParams(classDeclaration);

  return {
    className: prefixedClassName,
    filePath,
    baseClasses,
    // constructorParams,
    description,
  };
}

/**
 * Recursively searches a directory for TypeScript files
 */
function collectTypeScriptFiles(
  dir: string,
  storageProvider: StorageProvider
): string[] {
  let results: string[] = [];
  const actualDir = storageProvider.getFullPath(dir);

  if (!fs.existsSync(actualDir)) {
    console.warn(`Directory does not exist: ${actualDir}`);
    return results;
  }

  const list = fs.readdirSync(actualDir);

  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const actualFilePath = storageProvider.getFullPath(filePath);
    const stat = fs.statSync(actualFilePath);

    if (stat && stat.isDirectory() && file !== 'node_modules' && !file.startsWith('.')) {
      // Recursively search subdirectories
      results = results.concat(collectTypeScriptFiles(filePath, storageProvider));
    } else if (file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.endsWith('.test.ts') && !file.endsWith('.spec.ts')) {
      // Include TypeScript files but exclude declaration files
      results.push(filePath);
    }
  });

  return results;
}

/**
 * Main function to search for actor classes
 */
export async function populateClassesInfo(
  options: ActorSearchOptions = {}
): Promise<ActorsSearchResult> {
  const {
    classesToSearch = [],
    includeConstructorParams = false
  } = options;

  const dirs = [];
  if (Object.values(classesToSearch).some(className => className.startsWith(ENGINE.Prefix.ENGINE))) {
    dirs.push(ENGINE.ENGINE_PATH_PREFIX);
  }
  if (Object.values(classesToSearch).some(className => className.startsWith(ENGINE.Prefix.GAME))) {
    dirs.push(ENGINE.PROJECT_PATH_PREFIX);
  }

  const storageProvider = new StorageProvider();

  // Collect TypeScript files
  const files: string[] = [];
  for (const dir of dirs) {
    const dirFiles = collectTypeScriptFiles(dir, storageProvider);
    files.push(...dirFiles);
    console.log(`Found ${dirFiles.length} TypeScript files in ${dir}`);
  }

  console.log(`Total TypeScript files found: ${files.length}`);

  // Create ts-morph project
  const project = createTsMorphProject(storageProvider);

  // Add files to ts-morph project (limit for performance)
  const filesToAnalyze = files;
  console.log(`Analyzing ${filesToAnalyze.length} files with ts-morph...`);

  for (const filePath of filesToAnalyze) {
    try {
      const actualPath = storageProvider.getFullPath(filePath);
      if (fs.existsSync(actualPath)) {
        project.addSourceFileAtPath(actualPath);
      }
    } catch (error) {
      console.warn(`Failed to add file ${filePath}:`, error instanceof Error ? error.message : String(error));
    }
  }

  const result: ActorsSearchResult = {
    metadataDescription: includeConstructorParams ? createMetadataDescription() : {},
    actors: {}
  };

  // Analyze each source file for actor classes
  let totalClasses = 0;
  let actorClasses = 0;

  const engineFullPath = storageProvider.getFullPath(ENGINE.ENGINE_PATH_PREFIX);

  for (const sourceFile of project.getSourceFiles()) {
    const isEngineClass = sourceFile.getFilePath().startsWith(engineFullPath);
    const classPrefix = isEngineClass ? ENGINE.Prefix.ENGINE : ENGINE.Prefix.GAME;
    const classes = sourceFile.getClasses();
    totalClasses += classes.length;

    for (const classDecl of classes) {
      const actorInfo = analyzeActorClassBasics(sourceFile, classDecl, classPrefix);
      if (actorInfo) {
        actorClasses++;
        console.log(`Found Actor-derived class: ${actorInfo.className} in ${path.basename(actorInfo.filePath)}`);

        if (includeConstructorParams) {
          actorInfo.constructorParams = extractConstructorParams(classDecl);
          // Determine if the entire actor can be populated from JSON
          actorInfo.canPopulateFromJson = canActorBePopulatedFromJson(actorInfo.constructorParams);
        }

        if (!classesToSearch || classesToSearch.length === 0 || classesToSearch.includes(actorInfo.className)) {
          result.actors[actorInfo.className] = actorInfo;
        }
      }
    }
  }

  console.log(`✅ Analysis complete: ${totalClasses} total classes, ${actorClasses} Actor-derived classes found`);

  return result;
}

