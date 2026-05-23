const { execSync } = require("child_process")

function run(cmd) {
  console.log(`\n> ${cmd}`)
  execSync(cmd, { stdio: "inherit" })
}

function getTimestamp() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, "0")

  const y = now.getFullYear()
  const m = pad(now.getMonth() + 1)
  const d = pad(now.getDate())
  const h = pad(now.getHours())
  const min = pad(now.getMinutes())

  return `${y}-${m}-${d} ${h}:${min}`
}

try {
  run("npm run gen")
  run("npx quartz build")

  run("git add .")

  let hasChanges = true
  try {
    execSync("git diff --cached --quiet", { stdio: "ignore" })
    hasChanges = false
  } catch {
    hasChanges = true
  }

  if (!hasChanges) {
    console.log("\nNo changes to publish.")
    process.exit(0)
  }

  const message = `update site content ${getTimestamp()}`
  run(`git commit -m "${message}"`)
  run("git push origin main")

  console.log("\nPublish completed. GitHub Actions will deploy the site automatically.")
} catch (err) {
  console.error("\nPublish failed.")
  process.exit(1)
}