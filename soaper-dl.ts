#!/usr/bin/env node

// import os from 'node:os'
// import fs from 'node:fs'
import url from 'node:url'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
// import * as readline from 'node:readline/promises'
import * as cheerio from 'cheerio'

type Payload = {
  dlLinks: {m3u8Link: string, subLink: string | null};
  fileName: string;
  isSeries: boolean;
  ajaxType: string;
  year: string;
  name: string;
  link: string;
}

// const tempFile = path.join(os.tmpdir(), 'soaper.tmp')
const filename = path.basename(url.fileURLToPath(import.meta.url))
const searchTerm = process.argv.slice(2).join('%20')

if (searchTerm === '-h' || searchTerm === '--help') {
  console.log(`Usage: ${filename} <SEARCH TERM>`)
  process.exit(1)
}

if (!searchTerm) {
  // TODO: fetch new release list to fzf
  console.info('[soaper-dl-info] Nothing found, try another search term')
  process.exit(0)
}

const BASE_URI = 'https://soaper.tv'
const SUB_DL_PATH =  '/d/Videos'

async function search(): Promise<string> {
  const searchUrl = `${BASE_URI}/search.html?keyword=`

  // console.log('search: ', searchUrl + searchTerm )
  const $ = await fetch(searchUrl + searchTerm)
  .then(res => res.text())
  .then(html => cheerio.load(html))

  const results = $('div.thumbnail')
  if (results.length === 0) {
    console.info('[soaper-dl-info] Nothing found, try another search term')
    process.exit(0)
  }

  const fzfLines: string[] = []
  results.each((_i, el) => {
    const [year, title]: string[] = $(el).text().split('\n').filter( e => e !== '')
    const href =  $(el).find('h5 > a').attr('href') as string
    // console.log('year:', year)
    // console.log('title:', title)
    // console.log('href:', href)

    fzfLines.push(`[${year}] ${title.replaceAll(' ', '_')} ${BASE_URI + href}`)
  })

  const fzf = spawnSync(`echo "${fzfLines.join('\n')}" | fzf --header-first --header="Search Results" --cycle --with-nth 1,2`, {
    // stdout has to be pipe here
    stdio: ['inherit', 'pipe', 'inherit'],
    shell: true,
    encoding: 'utf-8'
  })

  return fzf.stdout.replace(/\n$/, '')
}

function sanitizeName(name: string): string {
  // illegal chars: / ? < > \ : * | " and ' causes problems when in filename
  return name.replace(/[/\\*?<>|']/g, '')
}

async function main() {
  // eg. '[2024] V/H/S/Beyond https://soaper.tv/movie_PnG636Pk7v.html'
  const chosenLink: string = await search()
  if (!chosenLink) process.exit(1)

  const [year, name, link] = chosenLink.split(' ')
  const fileName = `${sanitizeName(name)}_${year}`
  const isSeries = chosenLink.includes('/tv')
  const ajaxType = isSeries ? 'GetEInfoAjax' : 'GetMInfoAjax'
  const dlLinks =  await getDlLinks(link, ajaxType)

  const payload: Payload = {
    dlLinks,
    fileName,
    isSeries,
    ajaxType,
    year,
    name,
    link
  }

  download(payload)
}

async function getDlLinks(link: string, ajaxType: string): Promise<{m3u8Link: string, subLink: string | null}> {
  const pass: string = link.match(/_(?<pass>.*)\.html/)?.groups?.pass ?? ''
  if (!pass) throw '[soaper-dl-error] Couldn\'t get passkey'
    const res = await fetch(`${BASE_URI}/home/index/${ajaxType}`, {
      "headers": {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Referer": `${BASE_URI}${link}`
      },
      "body": `pass=${pass}`,
      "method": "POST"
    }).then(r => r.json())
    // console.log('res:', res)
    type Res = {
      subs: null | Array<{name: string, path: string}>,
      val: string
    }

    const {subs, val: m3u8Link }: Res = res
    const subPath: {path: string, name: string } | undefined = subs?.find(sub => sub.name.includes('en'))

    return {
      m3u8Link,
      subLink: subPath?.path ? subPath.path : null
    }
}

async function download({dlLinks, fileName, isSeries, year, name, link}: Payload) {

  if (!isSeries) {
    if (dlLinks.subLink) {
      const subPath = `${SUB_DL_PATH}/${fileName}.en.srt`
      console.info(`[soaper-dl-info] Downloading subtitles to ${subPath}`)
      spawnSync(`curl ${BASE_URI + dlLinks.subLink} -o ${subPath}`, {
        stdio: ['inherit', 'inherit', 'inherit'],
        shell: true,
        encoding: 'utf-8'
      })
    }


    console.info(`[soaper-dl-info] Downloading movie ${SUB_DL_PATH}/${fileName}`)
    // console.log('command:', `yt-dlp '${BASE_URI + dlLinks.m3u8Link}' -o ${fileName}.mp4`)
    spawnSync(`yt-dlp '${BASE_URI + dlLinks.m3u8Link}' -o ${fileName}.mp4`, {
      stdio: ['inherit', 'inherit', 'inherit'],
      shell: true,
      encoding: 'utf-8'
    })
  }

  if (isSeries) {
    function zeroPad(n: number): string { return Number(n) < 10 ? '0' + n : String(n) }
    // get list of eps and links
    const $ = await fetch(link)
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
    // sort selected ep
    const episodes = fzf.stdout.split('\n').sort()

    for (const ep of episodes) {
      if (!ep) continue
        console.log('ep:', ep)
      const [episode, name, link] = ep.split(' ')
      // console.log('link:', link)
      // console.log('name:', name)
      // console.log('episode:', episode)
      //
      // TODO: getDlLinks for link before passing to ytdlp

      const fileName = `${episode}_${sanitizeName(name)}`
      console.info(`[soaper-dl-info] Downloading episode ${SUB_DL_PATH}/${fileName}`)
      // console.log('command:', `yt-dlp '${link}' -o ${fileName}.mp4`)
      spawnSync(`yt-dlp '${link}' -o ${fileName}.mp4`, {
        stdio: ['inherit', 'inherit', 'inherit'],
        shell: true,
        encoding: 'utf-8'
      })
    }
  }
}

main().catch(err => {
  console.log(err)
  process.exit(1)
})

