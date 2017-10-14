#!/usr/bin/env node --harmony

// installation: npm install && npm link

const inquirer = require('inquirer')
const program = require('commander')
const axios = require('axios')
const stringSimilarity = require('string-similarity')
const numeral = require('numeral')
const path = require('path')
const fs = require('fs')

const key = '<TVDB KEY>'

function askForMatches(files, episodes) {
  const parsedFiles = files.map(path.parse)
  const questions = parsedFiles
    .map((fileParts, index) => ({
      type: 'list',
      name: `${index}`,
      message: `match for ${fileParts.base}?`,
      choices: (previousMatches) => getChoices(fileParts.name, episodes, previousMatches),
      default: 0,
    }))

  return inquirer.prompt(questions)
  .then((answers) => {
    return Object.keys(answers)
      .reduce((prev, cur) => {
        const response = answers[cur]
        if (response !== 'skip')
        {
          const fileDetail = parsedFiles[Number(cur)]
          const prevName = path.format(fileDetail)
          const newName = path.format({
            dir: fileDetail.dir,
            ext: fileDetail.ext,
            name: response,
          })
          prev[prevName] = newName
        }
        return prev
      }, {})
  })
}

function getChoices(fileName, episodes, previousMatches) {
  const previousResponses = Object.values(previousMatches)
  const possibleEpisodes = episodes.filter(name => !previousResponses.includes(name))
  const bestMatches = stringSimilarity.findBestMatch(fileName, episodes).ratings

  bestMatches.sort((first, second) => second.rating - first.rating)
  const options = bestMatches.slice(0, 20).map(match => ({
    name: `${match.target} <${match.rating.toFixed(2)}>`,
    value: match.target,
  }))

  if (bestMatches.length && bestMatches[0].rating > 0.5)
    return [...options, 'skip']
  return ['skip', ...options]
}

function getApi() {
  const api = axios.create({
    baseURL: 'https://api.thetvdb.com/',
  })

  return api.post('login', {
    apikey: key
  })
  .then(response => {
    api.defaults.headers['Authorization'] = `Bearer ${response.data.token}`
    return api
  })
}

function getEpisodes(seriesIdOrName) {
  return getApi()
  .then(api => {
    // TODO: check if seriesId is a number or a string
    return api.get('search/series', {
      params: {
        name: seriesIdOrName
      }
    })
    .then(response => {
      if (response.data.data.length == 1) {
        return response.data.data[0]
      }

      return inquirer.prompt({
        type: 'list',
        name: 'series',
        message: `Which series did you mean?`,
        choices: response.data.data.map(d => ({
          name: d.seriesName,
          value: series,
        })),
      })
      .then(answers => answers.series)
    })
    .then(series => {
      return new Promise((resolve, reject) => {
        console.log(`get page 1`)
        const getPage = (prevEpisodes, page) => {
          api.get(`/series/${series.id}/episodes`, {params: {page}}).then(result => {
            const episodes = [...prevEpisodes, ...result.data.data]
            if (result.data.links.next !== null) {
              console.log(`get page ${result.data.links.next} of ${result.data.links.last}`)
              return getPage(episodes, result.data.links.next)
            }
            resolve([episodes, series])
          }).catch(reject)
        };
        getPage([], 1)
      })
    })
  })
  .then(([episodes, series]) => {
    return episodes
      .filter(episode => episode.episodeName)
      .map(episode => ({
        seriesName: series.seriesName,
        series: numeral(episode.airedSeason).format('00'),
        episode: numeral(episode.airedEpisodeNumber).format('00'),
        name: episode.episodeName,
      }))
      .map(e => `${e.seriesName} - S${e.series}E${e.episode} - ${e.name}`)
  })
}

function renameFiles(oldToNewPairs) {
  if (!Object.keys(oldToNewPairs))
    return

  for (const from of Object.keys(oldToNewPairs)) {
    const to = oldToNewPairs[from]
    console.log(`mv "${from}"`)
    console.log(`=> "${to}"`)
    console.log("")
  }

  inquirer.prompt({
      type: 'confirm',
      name: 'ok',
      message: 'move files?',
      default: false,
  }).then((answers) => {
    if (!answers.ok)
      return
    for (const from of Object.keys(oldToNewPairs)) {
      const to = oldToNewPairs[from]
      console.log(`mv "${from}" "${to}"`)
      fs.renameSync(from, to)
    }
  })

}

program
  .arguments('<seriesId> <files...>')
  .action((seriesId, files) => {
    getEpisodes(seriesId)
      .then(episodes => askForMatches(files, episodes))
      .then(renameFiles)
  })
  .parse(process.argv);

// vim: et, ts=2, sts=2
