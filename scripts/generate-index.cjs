const fs = require("fs")
const path = require("path")

const rootDir = path.resolve(__dirname, "..")
const contentDir = path.join(rootDir, "content")

const sections = [
  {
    dir: "tech",
    title: "技术笔记",
    description:
      "这里记录嵌入式 Linux、RK3588、SLAM、点云、多传感器、MQTT、Qt/OpenGL 等技术实践。",
  },
  {
    dir: "projects",
    title: "项目案例",
    description:
      "这里整理我参与或主导过的项目案例，重点记录项目背景、核心问题、技术方案、关键难点和项目复盘。",
  },
  {
    dir: "methodology",
    title: "方法论",
    description:
      "这里沉淀项目复盘、技术调试、方案写作、产品分析和职业表达的方法。",
  },
  {
    dir: "resources",
    title: "资源库",
    description:
      "这里放置可复用的模板、清单、框架和工具。",
  },
]

function walkMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) return []

  const result = []

  for (const item of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, item)
    const stat = fs.statSync(fullPath)

    if (stat.isDirectory()) {
      result.push(...walkMarkdownFiles(fullPath))
      continue
    }

    if (!item.endsWith(".md")) continue
    if (item.toLowerCase() === "index.md") continue

    result.push(fullPath)
  }

  return result
}

function parseFrontmatter(text) {
  const meta = {}

  if (!text.startsWith("---")) return meta

  const end = text.indexOf("\n---", 3)
  if (end === -1) return meta

  const raw = text.slice(3, end).trim()
  const lines = raw.split(/\r?\n/)

  for (const line of lines) {
    const index = line.indexOf(":")
    if (index === -1) continue

    const key = line.slice(0, index).trim()
    let value = line.slice(index + 1).trim()

    if (value === "true") value = true
    else if (value === "false") value = false
    else if (value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
    }

    meta[key] = value
  }

  return meta
}

function isPublished(meta) {
  return meta.publish === true || meta.publish === "true"
}

function generateSectionIndex(section) {
  const sectionDir = path.join(contentDir, section.dir)
  const files = walkMarkdownFiles(sectionDir)

  const articles = files
    .map((file) => {
      const text = fs.readFileSync(file, "utf8")
      const meta = parseFrontmatter(text)

      if (!isPublished(meta)) return null

      const relativePath = path
        .relative(contentDir, file)
        .replace(/\\/g, "/")
        .replace(/\.md$/, "")

      return {
        title: meta.title || path.basename(file, ".md"),
        date: meta.date || "",
        summary: meta.summary || "",
        link: relativePath,
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))

  let content = `---\n`
  content += `title: ${section.title}\n`
  content += `publish: true\n`
  content += `---\n\n`
  content += `# ${section.title}\n\n`
  content += `${section.description}\n\n`

  if (articles.length === 0) {
    content += `## 文章列表\n\n`
    content += `暂无已发布文章。\n`
  } else {
    content += `## 文章列表\n\n`

    for (const article of articles) {
      content += `- [[${article.link}|${article.title}]]`

      const extra = []
      if (article.date) extra.push(article.date)
      if (article.summary) extra.push(article.summary)

      if (extra.length > 0) {
        content += ` — ${extra.join(" · ")}`
      }

      content += `\n`
    }
  }

  fs.writeFileSync(path.join(sectionDir, "index.md"), content, "utf8")
  console.log(`Generated: content/${section.dir}/index.md`)
}

for (const section of sections) {
  generateSectionIndex(section)
}

console.log("All indexes generated successfully.")