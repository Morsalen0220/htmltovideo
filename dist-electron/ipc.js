"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const path = require("path");
const fs = require("fs");
const os = require("os");
const activeJobs = /* @__PURE__ */ new Map();
function registerRenderHandlers(ipcMain, getWindow) {
  ipcMain.handle("render:start", async (_, config) => {
    try {
      const { startRenderJob } = require("./renderer");
      const job = startRenderJob(config, (progress) => {
        var _a;
        (_a = getWindow()) == null ? void 0 : _a.webContents.send("render:progress", progress);
      });
      activeJobs.set(config.jobId, { process: job.process, cancelled: false });
      job.promise.then(() => {
        var _a;
        activeJobs.delete(config.jobId);
        (_a = getWindow()) == null ? void 0 : _a.webContents.send("render:complete", {
          jobId: config.jobId,
          outputFile: config.outputFile
        });
      }).catch((error) => {
        var _a;
        activeJobs.delete(config.jobId);
        (_a = getWindow()) == null ? void 0 : _a.webContents.send("render:error", {
          jobId: config.jobId,
          error: error.message || String(error)
        });
      });
      return { success: true, jobId: config.jobId };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
  ipcMain.handle("render:cancel", async (_, jobId) => {
    const job = activeJobs.get(jobId);
    if (job) {
      job.cancelled = true;
      try {
        job.process.kill("SIGTERM");
      } catch (_2) {
      }
      activeJobs.delete(jobId);
      const tempDir = path.join(os.tmpdir(), `h2v-${jobId}`);
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      return { success: true };
    }
    return { success: false, error: "Job not found" };
  });
  ipcMain.handle("render:status", async (_, jobId) => {
    return { active: activeJobs.has(jobId) };
  });
}
exports.registerRenderHandlers = registerRenderHandlers;
