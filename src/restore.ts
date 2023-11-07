import * as cache from "@actions/cache";
import * as utils from "@actions/cache/lib/internal/cacheUtils";
import { extractTar, listTar } from "@actions/cache/lib/internal/tar";
import * as core from "@actions/core";
import * as path from "path";
import { Operator } from "opendal";
import { State } from "./state";
import * as fs from "fs";
import {
  findObject,
  formatSize,
  getInputAsArray,
  getInputAsBoolean,
  isGhes,
  setCacheHitOutput,
  saveMatchedKey,
} from "./utils";
import axios from "axios";

process.on("uncaughtException", (e) => core.info("warning: " + e.message));

async function restoreCache() {
  try {
    const provider = core.getInput("provider", { required: true });
    const endpoint = core.getInput("endpoint");
    const bucket = core.getInput("bucket", { required: true });
    const root = core.getInput("root");
    const key = core.getInput("key", { required: true });
    const useFallback = getInputAsBoolean("use-fallback");
    const paths = getInputAsArray("path");
    const restoreKeys = getInputAsArray("restore-keys");

    try {
      // Inputs are re-evaluted before the post action, so we want to store the original values
      core.info('Running try section from test branch');
      core.info(`provider is ${provider}`);
      core.info(`endpoint is ${endpoint}`);
      core.info(`bucket is ${bucket}`);
      core.info(`root is ${root}`);
      core.saveState(State.PrimaryKey, key);

      const op = new Operator(provider, { endpoint, bucket, root });
      core.info('Created op object');
      core.info(`op is ${JSON.stringify(op)}`);
      const compressionMethod = await utils.getCompressionMethod();
      const cacheFileName = utils.getCacheFileName(compressionMethod);
      const archivePath = path.join(
        await utils.createTempDirectory(),
        cacheFileName
      );
      core.info('Attempting to find cache object');
      core.info(`op data is ${JSON.stringify(op)}`)
      const { item: obj, metadata, matchingKey } = await findObject(
        op,
        key,
        restoreKeys,
        compressionMethod
      );
      core.debug("found cache object");
      saveMatchedKey(matchingKey);
      core.info(
        `Downloading cache from ${provider} to ${archivePath}. bucket: ${bucket}, root: ${root}, object: ${obj}`
      );
      let startDownloadTimestamp = Date.now();
      core.debug(`Starting download archive from ${provider} at timestamp ${startDownloadTimestamp}`);
      const req = await op.presignRead(obj, 600);

      core.debug(`Presigned request Method: ${req.method}, Url: ${req.url}`);
      for (const key in req.headers) {
        core.debug(`Header: ${key}: ${req.headers[key]}`);
      }
      const response = await axios({
        method: req.method,
        url: req.url,
        headers: req.headers,
        responseType: "stream",
      });
      await fs.promises.writeFile(archivePath, response.data);
      core.debug(`Finished downloading archive from ${provider} at timestamp ${Date.now()}`);
      core.debug(`Elapsed time: ${(Date.now() - startDownloadTimestamp) / 1000}`);
      if (core.isDebug()) {
        await listTar(archivePath, compressionMethod);
      }
      let size = 0;
      if (metadata?.contentLength) {
        size = Number(metadata.contentLength);
      }
      core.info(`Cache Size: ${formatSize(size)} (${size} bytes)`);
      let startDecompressionTimestamp = Date.now();
      core.debug(`Starting decompressing at timestamp ${startDecompressionTimestamp}`);
      await extractTar(archivePath, compressionMethod);
      core.debug(`Finished downloading archive from ${provider} at timestamp ${Date.now()}`);
      core.debug(`Elapsed time: ${(Date.now() - startDecompressionTimestamp) / 1000}`);
      setCacheHitOutput(matchingKey === key);
      core.info(`Cache restored from ${provider} successfully`);
    } catch (e) {
      core.info('Running error section from test branch');
      core.info(`Restore ${provider} cache failed: ${e}`);
      setCacheHitOutput(false);
      if (useFallback) {
        if (isGhes()) {
          core.warning("Cache fallback is not supported on Github Enterpise.");
        } else {
          core.info("Restore cache using fallback cache");
          const fallbackMatchingKey = await cache.restoreCache(
            paths,
            key,
            restoreKeys
          );
          if (fallbackMatchingKey) {
            setCacheHitOutput(fallbackMatchingKey === key);
            core.info("Fallback cache restored successfully");
          } else {
            core.info("Fallback cache restore failed");
          }
        }
      }
    }
  } catch (e) {
    core.setFailed(`${e}`);
  }
}

restoreCache();
