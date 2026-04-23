import path from 'path';

import * as ENGINE from '@gnsx/genesys.js';

import { getProjectRoot } from './common.js';
import { isSubclass } from './mcp/utils.js';
import { fixUpClassName, registerGameClasses } from './mcp/utils.js';
import { StorageProvider } from './storageProvider.js';


export async function generateCode(className: string, filePath: string, baseClassName: string): Promise<boolean> {
  try {
    baseClassName = fixUpClassName(baseClassName);
  }
  catch (error) {
    // if the base class name is not found, register all game classes and try again
    await registerGameClasses();
    baseClassName = fixUpClassName(baseClassName);
  }

  using context = ENGINE.scopedProjectContext({project: 'mcp-project', storageProvider: new StorageProvider()});

  const testIsSubclass = (childName: string, parent: Function) => {
    const child = ENGINE.ClassRegistry.getRegistry().get(childName);
    if (!child) {
      return false;
    }
    return isSubclass(child, parent);
  };

  const fullFilePath = path.isAbsolute(filePath) ? filePath : path.join(getProjectRoot(), filePath);

  let fileGenerated = false;
  const isSubclassOfActor = testIsSubclass(baseClassName, ENGINE.Actor);
  if (isSubclassOfActor) {
    await ENGINE.WorldCommands.generateActorTemplateFile(className, fullFilePath, baseClassName);
    fileGenerated = true;
  }

  return fileGenerated;
}

