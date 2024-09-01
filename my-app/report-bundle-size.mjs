// Source: https://gist.github.com/terrymun/ba53d6921929e27bf9ad2b311fe08a21

import { constants, access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSize } from "gzip-size";
import { mkdirp } from "mkdirp";
// NOTE: As bundles can be shared between pages, we cache the results of file size calculation per script
const memoryCache = new Map();
(async () => {
  try {
    /**
     * @method
     * @param {string[]} scriptPaths An array of strings representing script paths
     * @returns {ScriptSize} A dictionary containig the summed raw and gzip sizes of all scripts
     */
    const getScriptSizes = async (scriptPaths) => {
      const scriptSizes = await Promise.all(
        scriptPaths.map((scriptPath) => getScriptSize(scriptPath)),
      );
      const res = scriptSizes.reduce(
        (acc, scriptSize) => {
          acc.raw += scriptSize.raw;
          acc.gzip += scriptSize.gzip;
          return acc;
        },
        { raw: 0, gzip: 0 },
      );
      return res;
    };
    /**
     * @method
     * @param {string} scriptPath Path to a script
     * @returns {Promise<ScriptSize>} A dictionary containig the raw and gzip sizes of the script
     */
    const getScriptSize = async (scriptPath) => {
      const encoding = "utf8";
      const p = path.join(nextMetaRoot, scriptPath);
      const foundScript = memoryCache.get(p);
      if (foundScript) {
        return foundScript;
      }
      const textContent = await readFile(p, encoding);
      const raw = Buffer.byteLength(textContent, encoding);
      const gzip = await gzipSize(textContent);
      const cacheEntry = { raw, gzip };
      memoryCache.set(p, cacheEntry);
      return cacheEntry;
    };
    /**
     * Reads options from `package.json` asynchronously
     * @method
     * @param {string} [pathPrefix=process.cwd()] pathPrefix The path to the directory where package.json is expected to be found
     * @returns An object containing the package name and the destructured config for the plugin
     */
    const getOptions = async (pathPrefix = process.cwd()) => {
      const pkg = JSON.parse(
        await readFile(path.join(pathPrefix, "package.json"), "utf8"),
      );
      return Object.assign(Object.assign({}, pkg.nextBundleAnalysis), {
        name: pkg.name,
      });
    };
    /**
     * Gets the output build directory, defaults to `.next`
     * @method
     * @param {object} options the options parsed from package.json.nextBundleAnalysis using `getOptions`
     * @returns {string}
     */
    const getBuildOutputDirectory = (options) => {
      return options.buildOutputDirectory || ".next";
    };
    // NOTE: Pull options from `package.json`
    const options = await getOptions();
    const buildOutputDirectory = getBuildOutputDirectory(options);
    // NOTE: Check to ensure the build output directory exists
    const nextMetaRoot = path.join(process.cwd(), buildOutputDirectory);
    try {
      await access(nextMetaRoot, constants.R_OK);
    } catch (_e) {
      throw new Error(
        `No build output found at "${nextMetaRoot}" - you may not have your working directory set correctly, or not have run "next build".`,
      );
    }
    const [buildManifest, appBuildManifest, appPathRoutesManifest] = (
      await Promise.all([
        readFile(path.join(nextMetaRoot, "build-manifest.json"), "utf8"),
        readFile(path.join(nextMetaRoot, "app-build-manifest.json"), "utf8"),
        readFile(
          path.join(nextMetaRoot, "app-path-routes-manifest.json"),
          "utf8",
        ),
      ])
    ).map((data) => JSON.parse(data));
    const globalAppDirBundle = buildManifest.rootMainFiles;
    const globalAppDirBundleSizes = await getScriptSizes(globalAppDirBundle);
    // NOTE: Use entries from `appPathRoutesManifest` so that we can get mapping between file system paths and Next.js routes
    const allAppRouteSizes = {};
    for (const [fileSystemPath, route] of Object.entries(
      appPathRoutesManifest,
    )) {
      // NOTE: We are only interested in routes point to layout or page fles
      if (
        !fileSystemPath.endsWith("/page") &&
        !fileSystemPath.endsWith("/layout")
      ) {
        continue;
      }
      const scriptSizes = await getScriptSizes(
        appBuildManifest.pages[fileSystemPath].filter(
          // NOTE: Filter out non-JS files as to match with the metrics reported by next build
          (filePaths) =>
            !globalAppDirBundle.includes(filePaths) &&
            filePaths.endsWith(".js"),
        ),
      );
      allAppRouteSizes[route] = scriptSizes;
    }
    // NOTE: Assemble raw data and sort app routes alphabetically
    const rawData = Object.assign(
      Object.assign(
        {},
        Object.fromEntries(
          Object.entries(allAppRouteSizes).sort((a, b) =>
            a[0].localeCompare(b[0]),
          ),
        ),
      ),
      { __global: globalAppDirBundleSizes },
    );
    // NOTE: Logs outputs in a table to GitHub actions runner for debugging purposes
    console.table(rawData);
    await mkdirp(path.join(nextMetaRoot, "analyze/"));
    await writeFile(
      path.join(nextMetaRoot, "analyze/__bundle_analysis.json"),
      JSON.stringify(rawData),
    );
  } catch (e) {
    if (e instanceof Error) {
      console.error(e.message);
    } else {
      console.error(`Encountered an unknown error: ${e}`);
    }
    process.exit(1);
  }
})();
