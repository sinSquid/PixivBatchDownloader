import { Tools } from './Tools'
import { EVT } from './EVT'
import { theme } from './Theme'
import { Colors } from './config/Colors'

// 日志
class Log {
  constructor() {
    this.scrollToBottom()

    window.addEventListener(EVT.list.clearLog, () => {
      this.clear()
    })
  }

  private logArea = document.createElement('div') // 输出日志的区域
  private id = 'logWrap' // 日志区域元素的 id
  private refresh = document.createElement('span') // 刷新时使用的元素
  private readonly levelColor = [
    'inherit',
    Colors.textSuccess,
    Colors.textWarning,
    Colors.textError,
  ]

  private max = 100
  private count = 0

  private toBottom = false // 指示是否需要把日志滚动到底部。当有日志被添加或刷新，则为 true。滚动到底部之后复位到 false，避免一直滚动到底部。

  // 添加日志
  /*
  str 日志文本
  level 日志等级
  br 换行标签的个数
  keepShow 追加日志的模式，默认为 true，把这一条日志添加后不再修改。false 则是刷新显示这条消息。

  level 日志等级：
  0 normal
  1 success
  2 warning
  3 error
  */
  private add(str: string, level: number, br: number, keepShow: boolean) {
    this.checkElement()
    let span = document.createElement('span')
    if (!keepShow) {
      span = this.refresh
    } else {
      this.count++
    }

    span.innerHTML = str

    span.style.color = this.levelColor[level]

    while (br > 0) {
      span.appendChild(document.createElement('br'))
      br--
    }

    this.logArea.appendChild(span)
    this.toBottom = true // 需要把日志滚动到底部
  }

  public log(str: string, br: number = 1, keepShow: boolean = true) {
    this.add(str, 0, br, keepShow)
  }

  public success(str: string, br: number = 1, keepShow: boolean = true) {
    this.add(str, 1, br, keepShow)
  }

  public warning(str: string, br: number = 1, keepShow: boolean = true) {
    this.add(str, 2, br, keepShow)
  }

  public error(str: string, br: number = 1, keepShow: boolean = true) {
    this.add(str, 3, br, keepShow)
  }

  private checkElement() {
    // 如果日志区域没有被添加到页面上，则添加
    let test = document.getElementById(this.id)
    if (test === null) {
      this.logArea.id = this.id
      this.logArea.classList.add('beautify_scrollbar', 'logWrap')
      Tools.insertToHead(this.logArea)
      theme.register(this.logArea)
    }

    // 如果页面上的日志条数超过指定数量，则清空
    // 因为日志数量太多的话会占用很大的内存。同时显示 8000 条日志可能占用接近 1 GB 的内存
    if (this.count > this.max) {
      this.logArea.innerHTML = ''
      this.count = 0
    }
  }

  // 清空日志
  public clear() {
    this.logArea.remove()
  }

  // 因为日志区域限制了最大高度，可能会出现滚动条，这里使日志总是滚动到底部
  private scrollToBottom() {
    window.setInterval(() => {
      if (this.toBottom) {
        this.logArea.scrollTop = this.logArea.scrollHeight
        this.toBottom = false
      }
    }, 800)
  }
}

const log = new Log()
export { log }
