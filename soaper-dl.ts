#!/usr/bin/env node

import os from 'node:os'
import fs from 'node:fs'
import url from 'node:url'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import * as readline from 'node:readline/promises'
import * as cheerio from 'cheerio'

const tempFile = path.join(os.tmpdir(), 'soaper.tmp')
const filename = path.basename(url.fileURLToPath(import.meta.url))
const searchTerm = process.argv.slice(2).join('%20')

if (!searchTerm) {
  console.log(`Usage: ${filename} <SEARCH TERM>`)
  process.exit(1)
}

const BASE_URI = 'https://soaper.tv'
const SUB_DL_PATH =  '/d/Videos/'

const search: string = async () => {
  const searchUrl = `${BASE_URI}/search.html?keyword=`

  // console.log('search: ', searchUrl + searchTerm )
  const $ = await fetch(searchUrl + searchTerm)
    .then(res => res.text())
    .then(html => cheerio.load(html))

  const results = $('div.thumbnail')
  console.log('resultslength:', results.length)
  if (results.length === 0) {
    console.log('[info] Nothing found, try another search term')
    process.exit(0)
  }

  const fzfLines: string[] = []
  results.each((i, el) => {
    const [year, title]: [string, string] = $(el).text().split('\n').filter( e => e !== '')
    const href: string =  $(el).find('h5 > a').attr('href')
    // console.log('year:', year)
    // console.log('title:', title)
    // console.log('href:', href)

    fzfLines.push(`[${year}] ${title.replaceAll(' ', '_')} ${BASE_URI + href}`)
  })

  const fzf = spawnSync(`echo "${fzfLines.join('\n')}" | fzf --cycle --with-nth 1,2`, {
    // stdout has to be pipe here
    stdio: ['inherit', 'pipe', 'inherit'],
    shell: true,
    encoding: 'utf-8'
  })

  return fzf.stdout.replace(/\n$/, '')
}

async function main() {
  // eg. '[2024] V/H/S/Beyond https://soaper.tv/movie_PnG636Pk7v.html'
  const chosenLink: string = await search()
  if (!chosenLink) process.exit(1)
  const [year, name, link] = chosenLink.split(' ')

  const fileName = `${name}_${year}`
  const isSeries = chosenLink.includes('/tv')
  const ajaxType = isSeries ? 'GetEInfoAjax' : 'GetMInfoAjax'

  const dlLinks =  await getDlLinks(link, ajaxType)
  console.log('links:', dlLinks)

  if (!isSeries) {
    // movie, just dl both links
    if (dlLinks.subLink) {
      const subPath = `${SUB_DL_PATH}/${fileName}.en.srt`
      console.info(`[info] downloading subs to ${subPath}`)
      spawnSync(`curl ${BASE_URI + dlLinks.subLink} -o ${subPath}`, {
        stdio: ['inherit', 'inherit', 'inherit'],
        shell: true,
        encoding: 'utf-8'
      })
    }

    spawnSync(`yt-dlp '${BASE_URI + dlLinks.m3u8Link}' -o ${fileName}.mp4`, {
      stdio: ['inherit', 'inherit', 'inherit'],
      shell: true,
      encoding: 'utf-8'
    })
  }

    // fs.writeFileSync(tempFile, vidUrls.join('\n'))
    //   const seasonNum = vidUrls[0].match(/S([0-9]{2})E/)[1]
    //   console.log(`[info] there are ${vidUrls.length} episodes in season ${seasonNum.replace(/^0/, '')}`)
    //   console.log(`[info] Use 'sed' like selection to choose what episodes to download (eg. "1p;5p;10,22p" to download episodes 1 5 and 10-22)`)
  //   const rl = readline.createInterface({
  //     input: process.stdin,
  //     output: process.stdout,
  //   })
  //   let chosenEps = `1,${vidUrls.length}p`
  //   const question = '[????]'
  //   const answer = await rl.question(`${question} (press enter to choose all) > `)
  //   rl.close()
  //   if (answer) chosenEps = answer
  //   spawnSync(`sed -n "${chosenEps}" ${tempFile} | xargs -tl yt-dlp`, {
  //     stdio: ['inherit', 'inherit', 'inherit'],
  //     shell: true,
  //     encoding: 'utf-8'
  //   })
  
}

async function getDlLinks(link: string, ajaxType: string) {
  const pass = link.match(/_(?<pass>.*)\.html/).groups.pass
  const res = await fetch(`${BASE_URI}/home/index/${ajaxType}`, {
    "headers": {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Referer": `${BASE_URI}${link}`
    },
    "body": `pass=${pass}`,
    "method": "POST"
  }).then(r => r.json())
  const {subs, val: m3u8Link }: {subs: Array<{name: string, path: string}>, m3u8Link: string} = res
  const subPath: {path: string, name: string } | undefined = subs.find(sub => sub.name.includes('en'))

  return {
    m3u8Link,
    subLink: subPath?.path ? subPath.path : null
  }
}

main().catch(err => {
  console.log(err)
  process.exit(1)
})

