const { execSync, execFileSync } = require("child_process")
const fs = require("fs")
const path = require("path")
const os = require("os")

const ROOT = path.resolve(__dirname, "..")
const GIT_DIR = path.join(ROOT, ".git")
const LOG_FILE = path.join(GIT_DIR, "publish.log")
const STATUS_FILE = path.join(GIT_DIR, "publish-status.txt")
const FAILED_MARK_FILE = path.join(GIT_DIR, "PUSH_FAILED.txt")

let stage = "start"

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

function writeStatus(text) {
  try {
    fs.writeFileSync(STATUS_FILE, `[${now()}]\n${text}\n`, "utf8")
  } catch {}
}

function safeText(text) {
  return String(text || "")
    .replace(/`/g, "'")
    .replace(/\$/g, "￥")
    .replace(/'@/g, "' @")
}

function notify(title, message, type = "info", seconds = 10) {
  if (process.platform !== "win32") return

  const iconMap = {
    info: 64,
    warn: 48,
    error: 16,
  }

  const icon = iconMap[type] || 64

  const ps = `
$ws = New-Object -ComObject WScript.Shell
$null = $ws.Popup(@'
${safeText(message)}
'@, ${seconds}, @'
${safeText(title)}
'@, ${icon})
`

  const tmp = path.join(os.tmpdir(), `damonlab_publish_${Date.now()}.ps1`)

  try {
    fs.writeFileSync(tmp, ps, "utf8")
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      tmp,
    ], {
      stdio: "ignore",
    })
  } catch {
  } finally {
    try {
      fs.unlinkSync(tmp)
    } catch {}
  }
}

function run(cmd, allowFail = false) {
  log("")
  log(`> ${cmd}`)

  try {
    const output = execSync(cmd, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 100 * 1024 * 1024,
      shell: true,
    })

    if (output && output.trim()) {
      log(output.trim())
    }

    return {
      ok: true,
      output: output || "",
    }
  } catch (err) {
    const output = `${err.stdout || ""}${err.stderr || ""}`

    if (output.trim()) {
      log(output.trim())
    }

    if (!allowFail) {
      throw err
    }

    return {
      ok: false,
      output,
    }
  }
}

function sleep(ms) {
  const buf = new SharedArrayBuffer(4)
  const arr = new Int32Array(buf)
  Atomics.wait(arr, 0, 0, ms)
}

function hasStagedChanges() {
  const result = run("git diff --cached --quiet", true)
  return !result.ok
}

function getCommitMessage() {
  return `update site content ${now()}`
}

function classifyPushError(output) {
  const text = output || ""

  if (
    /Failed to connect/i.test(text) ||
    /Could not resolve host/i.test(text) ||
    /Connection was reset/i.test(text) ||
    /SSL_read/i.test(text) ||
    /timed out/i.test(text) ||
    /network/i.test(text)
  ) {
    return "网络连接不稳定，GitHub 推送失败。内容已经保存在本地，下次重新点击发布即可继续补推。"
  }

  if (
    /Authentication failed/i.test(text) ||
    /Permission denied/i.test(text) ||
    /403/i.test(text) ||
    /could not read Username/i.test(text)
  ) {
    return "GitHub 登录或权限异常。请检查 GitHub 账号登录状态、凭据或 Token。"
  }

  if (
    /rejected/i.test(text) ||
    /fetch first/i.test(text) ||
    /non-fast-forward/i.test(text) ||
    /Updates were rejected/i.test(text)
  ) {
    return "远程仓库有新的提交，需要先同步远程内容。脚本会尝试自动 pull --rebase 后重新推送。"
  }

  if (/src refspec/i.test(text)) {
    return "Git 分支名称可能不一致。请检查当前分支是否为 main。"
  }

  return "GitHub 推送失败，原因暂未明确。内容已经保存在本地，可以稍后重新点击发布。"
}

function markPushFailed(reason) {
  const text = `
发布失败：GitHub push 没有成功。

失败原因：
${reason}

当前状态：
1. Markdown 文件已经保存在本地。
2. 本地 commit 不会丢。
3. 只是还没有成功推送到 GitHub。
4. 网络恢复后，再次双击“发布网站.bat”即可补推。
`

  try {
    fs.writeFileSync(FAILED_MARK_FILE, `[${now()}]\n${text}\n`, "utf8")
  } catch {}

  writeStatus(`PUSH_FAILED\n${text}`)

  notify(
    "Damon Lab 发布失败",
    "GitHub 推送失败，通常是网络问题。内容已保存在本地，下次双击发布即可继续补推。",
    "warn",
    15
  )

  log(text)
}

function clearPushFailed() {
  const hadFailed = fs.existsSync(FAILED_MARK_FILE)

  try {
    if (hadFailed) fs.unlinkSync(FAILED_MARK_FILE)
  } catch {}

  writeStatus("OK\n发布成功：本地内容已经成功 push 到 GitHub，GitHub Actions 会自动部署网站。")

  notify(
    "Damon Lab 发布成功",
    "内容已经成功推送到 GitHub。等待 1–3 分钟后，线上网站会自动更新。",
    "info",
    10
  )
}

function pushWithRetry() {
  let lastReason = "未知原因"

  for (let i = 1; i <= 3; i++) {
    log(`Push attempt ${i}/3`)

    const push = run("git push origin main", true)

    if (push.ok) {
      log("Push completed.")
      return {
        ok: true,
        reason: "",
      }
    }

    lastReason = classifyPushError(push.output)
    log(`Push failed reason: ${lastReason}`)

    const needPull =
      push.output.includes("rejected") ||
      push.output.includes("fetch first") ||
      push.output.includes("non-fast-forward") ||
      push.output.includes("Updates were rejected")

    if (needPull) {
      log("Remote has new changes. Trying git pull --rebase origin main ...")

      const pull = run("git pull --rebase origin main", true)

      if (!pull.ok) {
        lastReason = "自动 pull --rebase 失败，可能存在冲突，需要手动处理。"
        return {
          ok: false,
          reason: lastReason,
        }
      }

      continue
    }

    log("Push failed. Waiting before retry...")
    sleep(8000 * i)
  }

  return {
    ok: false,
    reason: lastReason,
  }
}

try {
  log("Publish started.")
  writeStatus("RUNNING\n正在生成索引、构建网站、提交并推送到 GitHub。")

  stage = "generate-index"
  run("npm run gen")

  stage = "build-quartz"
  run("npx quartz build")

  stage = "git-add"
  run("git add .")

  stage = "git-commit"
  if (hasStagedChanges()) {
    const message = getCommitMessage()
    run(`git commit -m "${message}"`)
  } else {
    log("No new file changes. Will still try to push pending commits.")
  }

  stage = "git-push"
  const pushed = pushWithRetry()

  if (!pushed.ok) {
    markPushFailed(pushed.reason)
    process.exit(1)
  }

  clearPushFailed()

  log("Publish completed. GitHub Actions will deploy the site automatically.")
  process.exit(0)
} catch (err) {
  const text = `
发布失败。

失败阶段：
${stage}

可能原因：
1. 如果失败在 generate-index，可能是文章 frontmatter 格式有问题。
2. 如果失败在 build-quartz，可能是 Markdown、代码块或 Quartz 构建问题。
3. 如果失败在 git-add / git-commit，可能是 Git 本地状态异常。
4. 如果失败在 git-push，通常是网络或 GitHub 连接问题。

你的本地文件不会丢失。
`

  writeStatus(`FAILED\n${text}`)
  log(text)

  notify(
    "Damon Lab 发布失败",
    `发布失败，失败阶段：${stage}。请查看 publish-status.txt 或命令窗口。`,
    "error",
    15
  )

  process.exit(2)
}