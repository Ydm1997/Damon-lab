const { spawn } = require("child_process")
const fs = require("fs")
const path = require("path")

const ROOT = path.resolve(__dirname, "..")
const WATCH_DIR = path.join(ROOT, "content")
const LOG_FILE = path.join(ROOT, ".git", "auto-publish.log")

const DEBOUNCE_MS = 90 * 1000

let timer = null
let isPublishing = false
let queued = false

function now() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function log(msg) {
  const line = `[${now()}] ${msg}`
  console.log(line)
  try {
    fs.appendFileSync(LOG_FILE, line + "\n", "utf8")
  } catch {}
}

function shouldIgnore(filename) {
  if (!filename) return true

  const f = filename.replace(/\\/g, "/")

  if (
    f === "tech/index.md" ||
    f === "projects/index.md" ||
    f === "methodology/index.md" ||
    f === "resources/index.md"
  ) {
    return true
  }

  const allowed = [
    ".md",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".svg",
    ".pdf",
  ]

  return !allowed.some((ext) => f.toLowerCase().endsWith(ext))
}

function schedulePublish(reason) {
  log(`Change detected: ${reason}`)

  if (timer) {
    clearTimeout(timer)
  }

  timer = setTimeout(() => {
    runPublish()
  }, DEBOUNCE_MS)

  log(`Publish scheduled in ${DEBOUNCE_MS / 1000} seconds.`)
}

function runPublish() {
  if (isPublishing) {
    queued = true
    log("Publish is already running. Queued another publish.")
    return
  }

  isPublishing = true
  queued = false

  log("Auto publish started.")

  const child = spawn(process.execPath, [path.join(ROOT, "scripts", "publish-site.cjs")], {
    cwd: ROOT,
    shell: false,
  })

  child.stdout.on("data", (data) => {
    const text = data.toString().trim()
    if (text) log(text)
  })

  child.stderr.on("data", (data) => {
    const text = data.toString().trim()
    if (text) log(text)
  })

  child.on("exit", (code) => {
    isPublishing = false

    if (code === 0) {
      log("Auto publish finished successfully.")
    } else {
      log(`Auto publish failed with code ${code}. It will retry on next change or restart.`)
    }

    if (queued) {
      log("Running queued publish.")
      schedulePublish("queued-change")
    }
  })
}

if (!fs.existsSync(WATCH_DIR)) {
  log(`Watch directory not found: ${WATCH_DIR}`)
  process.exit(1)
}

log("Auto publish watcher started.")
log(`Watching: ${WATCH_DIR}`)

fs.watch(WATCH_DIR, { recursive: true }, (eventType, filename) => {
  if (shouldIgnore(filename)) return
  schedulePublish(`${eventType}: ${filename}`)
})

schedulePublish("startup-check")