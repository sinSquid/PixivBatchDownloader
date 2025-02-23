// 下载文件，然后发送给浏览器进行保存
import { EVT } from '../EVT'
import { log } from '../Log'
import { lang } from '../Lang'
import { fileName } from '../FileName'
import { convertUgoira } from '../ConvertUgoira/ConvertUgoira'
import {
  downloadArgument,
  SendToBackEndData,
  DonwloadSkipData,
} from './DownloadType'
import { progressBar } from './ProgressBar'
import { filter } from '../filter/Filter'
import { deduplication } from './Deduplication'
import { settings } from '../setting/Settings'
import { MakeNovelFile } from './MakeNovelFile'
import { Utils } from '../utils/Utils'
import { Config } from '../config/Config'
import { msgBox } from '../MsgBox'
import { states } from '../store/States'

class Download {
  constructor(progressBarIndex: number, data: downloadArgument) {
    this.progressBarIndex = progressBarIndex
    this.beforeDownload(data)
  }

  private progressBarIndex: number

  private retry = 0 // 重试次数
  private lastRequestTime = 0 // 最后一次发起请求的时间戳
  private retryInterval: number[] = [] // 保存每次到达重试环节时，距离上一次请求的时间差

  private sizeChecked = false // 是否对文件体积进行了检查
  private skip = false // 这个下载是否应该被跳过。如果这个文件不符合某些过滤条件就应该跳过它
  private error = false // 在下载过程中是否出现了无法解决的错误

  private get cancel() {
    return this.skip || this.error || !states.downloading
  }

  // 跳过下载这个文件。可以传入用于提示的文本
  private skipDownload(data: DonwloadSkipData, msg?: string) {
    this.skip = true
    if (msg) {
      log.warning(msg)
    }
    if (states.downloading) {
      EVT.fire('skipDownload', data)
    }
  }

  // 在开始下载前进行检查
  private async beforeDownload(arg: downloadArgument) {
    // 检查是否是重复文件
    const duplicate = await deduplication.check(arg.data)
    if (duplicate) {
      return this.skipDownload(
        {
          id: arg.id,
          reason: 'duplicate',
        },
        lang.transl('_跳过下载因为重复文件', arg.id)
      )
    }

    // 如果是动图，再次检查是否排除了动图
    // 因为有时候用户在抓取时没有排除动图，但是在下载时排除了动图。所以下载时需要再次检查
    if (arg.data.type === 2 && !settings.downType2) {
      return this.skipDownload({
        id: arg.id,
        reason: 'excludedType',
      })
    }

    // 检查宽高条件和宽高比
    if ((settings.setWHSwitch || settings.ratioSwitch) && arg.data.type !== 3) {
      // 默认使用当前作品中第一张图片的宽高
      let wh = {
        width: arg.data.fullWidth,
        height: arg.data.fullHeight,
      }
      // 如果不是第一张图片，则加载图片以获取宽高
      if (arg.data.index > 0) {
        // 始终获取原图的尺寸
        wh = await Utils.getImageSize(arg.data.original)
      }

      // 如果获取宽高失败，图片会被视为通过宽高检查
      if (wh.width === 0 || wh.height === 0) {
        log.error(lang.transl('_获取图片的宽高时出现错误') + arg.id)
        // 图片加载失败可能是请求超时，或者图片不存在。这里无法获取到具体原因，所以不直接返回。
        // 如果是 404 错误，在 download 方法中可以处理这个问题
        // 如果是请求超时，则有可能错误的通过了这个图片
      }

      const result = await filter.check(wh)
      if (!result) {
        return this.skipDownload(
          {
            id: arg.id,
            reason: 'widthHeight',
          },
          lang.transl('_不保存图片因为宽高', arg.id)
        )
      }
    }

    this.download(arg)
  }

  // 设置进度条信息
  private setProgressBar(name: string, loaded: number, total: number) {
    progressBar.setProgress(this.progressBarIndex, {
      name,
      loaded,
      total,
    })
  }

  // 当重试达到最大次数时
  private afterReTryMax(status: number, fileId: string) {
    // 404, 500 错误，跳过，不会再尝试下载这个文件（因为没有触发 downloadError 事件，所以不会重试下载）
    if (status === 404 || status === 500) {
      log.error(`Error: ${fileId} Code: ${status}`)
      return this.skipDownload({
        id: fileId,
        reason: status.toString() as '404' | '500',
      })
    }

    // 状态码为 0 ，可能是系统磁盘空间不足导致的错误，也可能是超时等错误
    if (status === 0) {
      // 判断是否是磁盘空间不足。特征是每次重试之间的间隔时间比较短。
      // 超时的特征是等待时间比较长，可能超过 20 秒
      const timeLimit = 10000 // 如果从发起请求到进入重试的时间间隔小于这个值，则视为磁盘空间不足的情况
      const result = this.retryInterval.filter((val) => val <= timeLimit)
      // 在全部的 10 次请求中，如果有 9 次小于 10 秒，就认为是磁盘空间不足。
      if (result.length > 9) {
        log.error(`Error: ${fileId} Code: ${status}`)
        const tip = lang.transl('_状态码为0的错误提示')
        log.error(tip)
        msgBox.error(tip)
        return EVT.fire('requestPauseDownload')
      }
    }

    // 其他状态码，暂时跳过这个任务，但最后还是会尝试重新下载它
    this.error = true
    EVT.fire('downloadError', fileId)
  }

  // 下载文件
  private async download(arg: downloadArgument) {
    // 获取文件名
    const _fileName = fileName.getFileName(arg.data)

    // 重设当前下载栏的信息
    this.setProgressBar(_fileName, 0, 0)

    // 下载文件
    let url: string
    if (arg.data.type === 3) {
      // 生成小说的文件
      if (arg.data.novelMeta) {
        let blob: Blob = await MakeNovelFile.make(arg.data.novelMeta)
        url = URL.createObjectURL(blob)
      } else {
        throw new Error('Not found novelMeta')
      }
    } else {
      // 对于图像作品，如果设置了图片尺寸就使用指定的 url，否则使用原图 url
      url = arg.data[settings.imageSize] || arg.data.original
    }

    let xhr = new XMLHttpRequest()
    xhr.open('GET', url, true)
    xhr.responseType = 'blob'

    // 显示下载进度
    xhr.addEventListener('progress', async (event) => {
      // 检查体积设置
      if (!this.sizeChecked) {
        this.sizeChecked = true
        const result = await filter.check({ size: event.total })
        if (!result) {
          // 当因为体积问题跳过下载时，可能这个下载进度还是 0 或者很少，所以这里直接把进度条拉满
          this.setProgressBar(_fileName, 1, 1)
          this.skipDownload(
            {
              id: arg.id,
              reason: 'size',
            },
            lang.transl('_不保存图片因为体积', arg.id)
          )
        }
      }

      if (this.cancel) {
        xhr.abort()
        xhr = null as any
        return
      }

      this.setProgressBar(_fileName, event.loaded, event.total)
    })

    // 文件记载完毕，或者加载出错
    xhr.addEventListener('loadend', async () => {
      if (this.cancel) {
        xhr = null as any
        return
      }

      let file: Blob = xhr.response // 要下载的文件
      // 状态码错误，进入重试流程
      if (xhr.status !== 200) {
        // 正常下载完毕的状态码是 200
        // 储存重试的时间戳等信息
        this.retryInterval.push(new Date().getTime() - this.lastRequestTime)

        progressBar.errorColor(this.progressBarIndex, true)
        this.retry++

        if (this.retry >= Config.retryMax) {
          // 重试达到最大次数
          this.afterReTryMax(xhr.status, arg.id)
        } else {
          // 开始重试
          return this.download(arg)
        }
      } else {
        // 状态码正常
        progressBar.errorColor(this.progressBarIndex, false)

        // 需要转换动图的情况
        const convertExt = ['webm', 'gif', 'png']
        const ext = settings.ugoiraSaveAs
        if (
          convertExt.includes(ext) &&
          arg.data.ugoiraInfo &&
          settings.imageSize !== 'thumb'
        ) {
          // 当下载图片的方形缩略图时，不转换动图，因为此时下载的是作品的静态缩略图，无法进行转换
          try {
            if (ext === 'webm') {
              file = await convertUgoira.webm(file, arg.data.ugoiraInfo)
            }

            if (ext === 'gif') {
              file = await convertUgoira.gif(file, arg.data.ugoiraInfo)
            }

            if (ext === 'png') {
              file = await convertUgoira.apng(file, arg.data.ugoiraInfo)
            }
          } catch (error) {
            const msg = `Convert ugoira error, id ${arg.data.idNum}.`
            // 因为会重试所以不再日志上显示
            // log.error(msg, 1)
            console.error(msg)

            this.error = true
            EVT.fire('downloadError', arg.id)
          }
        }
      }

      if (this.cancel) {
        return
      }

      // 生成下载链接
      const blobUrl = URL.createObjectURL(file)

      // 对插画、漫画进行颜色检查
      // 在这里进行检查的主要原因：抓取时只能检测第一张的缩略图，并没有检查后面的图片。所以这里需要对后面的图片进行检查。
      // 另一个原因：如果抓取时没有设置不下载某种颜色的图片，下载时又开启了设置，那么就在这里进行检查
      if (arg.data.type === 0 || arg.data.type === 1) {
        const result = await filter.check({
          mini: blobUrl,
        })
        if (!result) {
          return this.skipDownload(
            {
              id: arg.id,
              reason: 'color',
            },
            lang.transl('_不保存图片因为颜色', arg.id)
          )
        }
      }

      // 向浏览器发送下载任务
      this.browserDownload(blobUrl, _fileName, arg.id, arg.taskBatch)
      xhr = null as any
      file = null as any
    })

    this.lastRequestTime = new Date().getTime()
    // 没有设置 timeout，默认值是 0，不会超时
    xhr.send()
  }

  // 向浏览器发送下载任务
  private browserDownload(
    blobUrl: string,
    fileName: string,
    id: string,
    taskBatch: number
  ) {
    // 如果任务已停止，不会向浏览器发送下载任务
    if (this.cancel) {
      // 释放 bloburl
      URL.revokeObjectURL(blobUrl)
      return
    }

    const sendData: SendToBackEndData = {
      msg: 'save_work_file',
      fileUrl: blobUrl,
      fileName: fileName,
      id,
      taskBatch,
    }

    chrome.runtime.sendMessage(sendData)
  }
}

export { Download }
