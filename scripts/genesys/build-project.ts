import { getProjectRoot, isDev } from './common.js';

const fileServerPort = !isDev ? 4000 : 4001;
const fileServerProtocol = process.env.GENESYS_FILE_SERVER_PROTOCOL ?? 'http';
const fileServerBaseUrl = process.env.GENESYS_FILE_SERVER_URL ?? `${fileServerProtocol}://localhost:${fileServerPort}`;

async function main() {
  try {
    const rootResponse = await fetch(`${fileServerBaseUrl}/`);

    if (!rootResponse.ok) {
      console.log('❌ Failed to talk to the Genesys SDK App, please make sure it is running and open the project in it!');
      return;
    }

    const projectPath = getProjectRoot();

    console.log(`🔨 Building project: ${projectPath} ...`);

    const buildResponse = await fetch(`${fileServerBaseUrl}/api/build-project`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectPath,
      }),
    });
    const responseJson = await buildResponse.json();
    if (!buildResponse.ok) {
      console.log('❌ Failed to build project, please check the console for errors!');
      console.log(responseJson);
      return;
    }

    /*
    success: result.success,
    message: result.message,
    error: result.error
    */
    if (!responseJson.success) {
      console.log(`❌ Failed to build project:\n - ${responseJson.error ?? responseJson.message}`);
      return;
    }

    console.log(`✅ ${responseJson.message}`);

  } catch (error) {
    console.log('❌ Failed to talk to the Genesys SDK App, please make sure it is running and open the project in it!');
  }
}

main();
