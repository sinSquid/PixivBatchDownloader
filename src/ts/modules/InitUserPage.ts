// 初始化用户页面
import { InitPageBase } from './InitPageBase'
import { Colors } from './Colors'
import { lang } from './Lang'
import { options } from './Options'
import { API } from './API'
import { store } from './Store'
import { log } from './Log'
import { DOM } from './DOM'
import { userWorksType, tagPageFlag } from './CrawlArgument.d'
import { pageInfo } from './PageInfo'

class InitUserPage extends InitPageBase {
  constructor() {
    super()
    this.init()
  }

  protected appendCenterBtns() {
    DOM.addBtn('crawlBtns', Colors.blue, lang.transl('_开始抓取'), [
      ['title', lang.transl('_开始抓取') + lang.transl('_默认下载多页')],
    ]).addEventListener('click', () => {
      this.readyCrawl()
    })
  }

  protected setFormOption() {
    // 设置“个数/页数”选项
    options.setWantPage({
      text: lang.transl('_页数'),
      tip: lang.transl('_checkWantPageRule1Arg8'),
      rangTip: lang.transl('_数字提示1'),
      value: '-1',
    })
  }

  private tag = '' // 储存当前页面的 tag，有时没有 tag

  private listType = 0 // 细分的列表类型

  private readonly onceNumber = 48 // 每页个数

  private requsetNumber = 0 // 根据页数，计算要抓取的作品个数

  private offset = 0 // 要去掉的作品数量

  protected getWantPage() {
    this.crawlNumber = this.checkWantPageInput(
      lang.transl('_checkWantPageRule1Arg6'),
      lang.transl('_checkWantPageRule1Arg7')
    )
  }

  protected nextStep() {
    this.readyGetIdList()
  }

  protected readyGetIdList() {
    // 如果前面有页数，就去掉前面页数的作品数量。即：从本页开始下载
    const nowPage = API.getURLField(location.href, 'p') // 判断当前处于第几页，页码从 1 开始。也可能没有页码
    if (nowPage) {
      this.offset = (parseInt(nowPage) - 1) * this.onceNumber
    }
    if (this.offset < 0) {
      this.offset = 0
    }

    // 根据页数设置，计算要下载的个数
    this.requsetNumber = 0
    if (this.crawlNumber === -1) {
      this.requsetNumber = 9999999
    } else {
      this.requsetNumber = this.onceNumber * this.crawlNumber
    }

    // 判断页面类型
    // 匹配 pathname 里用户 id 之后的字符
    const test = location.pathname.match(/\/users\/\d+(\/.+)/)
    if (test === null) {
      // 用户主页
      this.listType = 0
    } else if (test.length === 2) {
      const str = test[1] //取出用户 id 之后的字符
      if (str.includes('/artworks')) {
        // 插画和漫画列表
        this.listType = 1
      } else if (str.includes('/illustrations')) {
        // 插画列表
        this.listType = 2
      } else if (str.includes('/manga')) {
        // 漫画列表
        this.listType = 3
      } else if (str.includes('/novels')) {
        // 小说列表
        this.listType = 4
      }
    }

    ;(this.tag = pageInfo.getPageTag) ? this.getIdListByTag() : this.getIdList()

    log.log(lang.transl('_正在抓取'))
  }

  // 获取用户某些类型的作品的 id 列表
  protected async getIdList() {
    let type: userWorksType[] = []

    switch (this.listType) {
      case 0:
        type = ['illusts', 'manga', 'novels']
        break
      case 1:
        type = ['illusts', 'manga']
        break
      case 2:
        type = ['illusts']
        break
      case 3:
        type = ['manga']
        break
      case 4:
        type = ['novels']
        break
    }

    let idList = await API.getUserWorksByType(DOM.getUserId(), type)

    // 把作品 id 转换成数字
    let tempList: number[] = []
    tempList = idList.map((id) => {
      return parseInt(id)
    })
    // 升序排列
    tempList.sort(function (x, y) {
      return x - y
    })

    idList = tempList.map((id) => {
      return id.toString()
    })

    // 不带 tag 获取作品时，由于 API 是一次性返回用户的所有作品，可能大于要求的数量，所以需要去掉多余的作品。
    // 删除 offset 需要去掉的部分。删除后面的 id，也就是近期作品
    idList.splice(idList.length - this.offset, idList.length)

    // 删除超过 requsetNumber 的作品。删除前面的 id，也就是早期作品
    if (idList.length > this.requsetNumber) {
      idList.splice(0, idList.length - this.requsetNumber)
    }

    // 储存
    store.idList = store.idList.concat(idList)

    this.getIdListFinished()
  }

  // 获取用户某些类型的作品的 id 列表（附带 tag）
  private async getIdListByTag() {
    // 这里不用判断 0 也就是用户主页的情况，因为用户主页不会带 tag
    let flag: tagPageFlag = 'illustmanga'
    switch (this.listType) {
      case 1:
        flag = 'illustmanga'
        break
      case 2:
        flag = 'illusts'
        break
      case 3:
        flag = 'manga'
        break
      case 4:
        flag = 'novels'
        break
    }

    let data = await API.getUserWorksByTypeWithTag(
      DOM.getUserId(),
      flag,
      this.tag,
      this.offset,
      this.requsetNumber
    )

    data.body.works.forEach((data) => store.idList.push(data.id))

    this.getIdListFinished()
  }

  protected resetGetIdListStatus() {
    this.offset = 0
    this.tag = ''
    this.listType = 0
    this.listPageFinished = 0
  }

  protected sortResult() {
    // 把作品数据按 id 倒序排列，id 大的在前面，这样可以先下载最新作品，后下载早期作品
    store.result.sort(API.sortByProperty('id'))
  }
}
export { InitUserPage }
