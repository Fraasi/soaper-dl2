#!/usr/bin/env node

// import fs from 'node:fs'
// import os from 'node:os'
import url from 'node:url'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import * as cheerio from 'cheerio'


type Payload = {
  dlLinks: {m3u8Link: string, subLink: string | null};
  fileName: string;
  isSeries: boolean;
  pageLink: string;
}

type DlLinks = {
  m3u8Link: string;
  subLink: string | null;
}

const FILE_NAME = path.basename(url.fileURLToPath(import.meta.url))
const SEARCH_TERM = process.argv.slice(2).join(' ')
const BASE_URI = 'https://soaper.tv'
const SUB_LANG = 'en'
const SUB_DL_PATH =  '/d/Videos'


console.log('SEARCH_TERM:', SEARCH_TERM)
if (SEARCH_TERM === '-h' || SEARCH_TERM === '--help') {
  console.log(`Usage: ${FILE_NAME} <SEARCH TERM>`)
  process.exit(0)
}

if (!SEARCH_TERM) {
  // TODO: fetch new release list to fzf
  console.info('[soaper-dl] Nothing found, try another search term')
  process.exit(0)
}

async function search(): Promise<string> {
  const searchUrl = `${BASE_URI}/search.html?keyword=`

  const $ = await fetch(searchUrl + SEARCH_TERM)
  .then(res => res.text())
  .then(html => cheerio.load(html))

  const results = $('div.thumbnail.text-center')
  if (results.length === 0) {
    console.info('[soaper-dl] Nothing found, try another search term')
    process.exit(0)
  }

  const fzfLines: string[] = []
  results.each((_i, el) => {
    // 25.10 wtf, suddenly .text()  returns gazillion \n and \t
    // console.log('el:', $(el).text().replaceAll(/\t/g, '').split('\n').filter(e => (e !== '\n' && e !== '')))
    const year = $(el).find('.img-group > div').text()
    const title = $(el).find('h5').text().replaceAll(' ', '_')
    const href =  $(el).find('h5 > a').attr('href') as string
    fzfLines.push(`[${year}] ${title} ${BASE_URI + href}`)
  })

  const fzf = spawnSync(`echo "${fzfLines.join('\n')}" | fzf --header-first --header="Search Results" --cycle --with-nth 1,2`, {
    // stdout has to be pipe here to return results
    stdio: ['inherit', 'pipe', 'inherit'],
    shell: true,
    encoding: 'utf-8'
  })

  return fzf.stdout.replace(/\n$/, '')
}

function sanitizeName(name: string): string {
  // illegal chars: / ? < > \ : * | " and ' causes problems when in filename, also remove [ and ]
  return name.replace(/[/\\*?<>|'\[\]]/g, '')
}

async function getPayload(chosenLink: string): Promise<Payload> {
  const [yearOrEpNum, name, pageLink] = chosenLink.split(' ')
  const isSeries = ( chosenLink.includes('/tv_') || chosenLink.includes('/episode') )
  const ajaxType = isSeries ? 'GetEInfoAjax' : 'GetMInfoAjax'
  let fileName = isSeries ? `${yearOrEpNum}_${name}` : `${name}_${yearOrEpNum}`
  fileName = sanitizeName(fileName)
  const dlLinks: DlLinks =  await getDlLinks(pageLink, ajaxType)

  return {
    dlLinks,
    fileName,
    isSeries,
    pageLink
  }
}

async function getDlLinks(pageLink: string, ajaxType: string): Promise<DlLinks> {
  // console.log('getDlLinks:before')
  // console.log('ajaxType:', ajaxType)
  // console.log('pageLink:', pageLink)
  const pass: string = pageLink.match(/_(?<pass>.*)\.html/)?.groups?.pass ?? ''
  // console.log('pass:', pass)
  if (!pass) throw '[soaper-dl-error] Couldn\'t get passkey'

    const result = await fetch(`${BASE_URI}/home/index/${ajaxType}`, {
      "headers": {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Referer": `${BASE_URI}${pageLink}`
      },
      "body": `pass=${pass}`,
        "method": "POST"
    }).then(r => r.json())
    // console.log('getDlLinks:after result')

    // console.log('result:', result)
    type Links = {
      subs: null | Array<{name: string, path: string}>;
      val: string;
    }
    const {subs, val: m3u8Link }: Links = result
    if (m3u8Link === 'Cannot get video source.') throw '[soaper-dl-error] Cannot get video source.'
      const subPath: {path: string, name: string } | undefined = subs?.find(sub => sub.name.includes(SUB_LANG))

    return {
      m3u8Link,
      subLink: subPath?.path ? subPath.path : null
    }
}

async function runShell(command: string, std: 'pipe' | 'inherit' = 'inherit'): Promise<void> {
  spawnSync(command, {
    // stdout has to be pipe on some streams
    stdio: ['inherit', std, 'inherit'],
    shell: true,
    encoding: 'utf-8'
  })
}

async function startDownload({dlLinks, fileName, isSeries, pageLink}: Payload) {

  if (!isSeries) {
    if (dlLinks.subLink) {
      const subPath = `${SUB_DL_PATH}/${fileName}.en.srt`
      console.info(`[soaper-dl] Downloading subtitles ${subPath}`)
      runShell(`curl ${BASE_URI + dlLinks.subLink} -o ${subPath}`)
    }

    console.info(`[soaper-dl] Downloading movie ${SUB_DL_PATH}/${fileName}`)
    runShell(`yt-dlp '${BASE_URI + dlLinks.m3u8Link}' -o ${fileName}.mp4`)
  }

  if (isSeries) {
    function zeroPad(n: number): string { return Number(n) < 10 ? '0' + n : String(n) }
    // get list of eps and links
    const $ = await fetch(pageLink)
    .then(res => res.text())
    .then(html => cheerio.load(html))

    const seasons = $('.alert-info-ex')
    const fzfEpList: string[] = []
    // loop thru backwards, see webpage
    let seasonNum = 1
    let epNum = 1
    for (let i = seasons.length - 1; i >= 0; i--) {
      const eps = $(seasons[i]).find('a')
      for (let y = eps.length -1; y >= 0; y--) {
        const el = eps[y]
        const epName: string = $(el).text().replaceAll(' ', '_').split('.')[1] as string
        fzfEpList.push(`[S${zeroPad(seasonNum)}E${zeroPad(epNum++)}] ${epName} ${BASE_URI + $(el).attr('href')}`)
      }
      seasonNum++
        epNum = 1
    }

    const fzf = spawnSync(`echo "${fzfEpList.join('\n')}" | fzf --header-first --header="Choose episodes to download with <TAB>" --multi --cycle --with-nth 1,2`, {
      // stdout has to be pipe here
      stdio: ['inherit', 'pipe', 'inherit'],
      shell: true,
      encoding: 'utf-8'
    })

    // sort selected eps to dl oldest first
    const episodes = fzf.stdout.split('\n').sort()
    const commands: string[] = []
    for (const ep of episodes) {
      if (!ep) continue
        const { dlLinks, fileName }: Payload = await getPayload(ep)
      const { m3u8Link, subLink } = dlLinks
      if (subLink) {
        const subPath = `${SUB_DL_PATH}/${fileName}.en.srt`
        const commandCURL = `curl '${BASE_URI + subLink}' -o ${subPath}`
        commands.push(commandCURL)
        // runShell(commandCURL)
      }
      const commandYTDLP = `yt-dlp --quiet '${BASE_URI + m3u8Link}' -o ${fileName}.mp4`
      commands.push(commandYTDLP)
      // await runShell(commandYTDLP)
    }
    // console.log(commands.join('\n'))
    // await runShell(`echo ${commands.join('\n')} | xargs -tl yt-dlp`)
    for (const command of commands){
      console.info(`[soaper-dl] Downloading ${command.split(' ').at(-1)}`)
      // running 'command' thru runShell func doesn't work for sequential ddownloads for some reason
      spawnSync(command, {
        // stdout has to be inherit here
        stdio: ['inherit', 'inherit', 'inherit'],
        shell: true,
        encoding: 'utf-8'
      })
    }
    //   if (link.endsWith('srt')) await runShell(`curl ${link}`)
    //   else if (link.endsWith('mp4')) await runShell(`yt-dlp ${link}`)
    //   else console.error(`WTF link: ${link}`)
    // }
    // fs.writeFileSync(TEMP_FILE, commands.join('\n'))
    // console.log('TEMP_FILE:', TEMP_FILE)
    // spawnSync(`sed -n "${chosenEps}" ${TEMP_FILE} | xargs -tl yt-dlp`, {
    // console.log(`xargs -tL 1 --arg-file=${TEMP_FILE}`)
    // if (
    // await runShell(`xargs -d'\n' -L 1 --arg-file=${TEMP_FILE}`)
  }
}

async function main() {
  const chosenLink: string = await search().catch(err => {
    console.error('[soaper-dl-error] Search fetch failed')
    console.error(err)
    process.exit(1)
  })
  if (!chosenLink) process.exit(1)
    const payload: Payload = await getPayload(chosenLink)
  startDownload(payload)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

