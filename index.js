#!/usr/bin/env node --harmony

const inquirer = require('inquirer')
const program = require('commander')
const axios = require('axios')
const stringSimilarity = require('string-similarity')

const key = '<TVDB KEY>'

function askForMatches(files, episodes) {
  const questions = files.map((file, index) => ({
    type: 'list',
    name: `${index}`,
    message: `match for ${file}?`,
    choices: (previousMatches) => getChoices(file, episodes, previousMatches),
    default: 'skip'
  }))

  return inquirer.prompt(questions)
  .then((answers) => {
    return Object.keys(answers)
      .reduce((prev, cur) => {
        const file = files[Number(cur)]
        const response = answers[cur]
        if (response !== 'skip')
          prev[file] = answers[cur]
        return prev
      }, {})
  })
}

function getChoices(file, episodes, previousMatches) {
  const previousResponses = Object.values(previousMatches)
  const possibleEpisodes = episodes.filter(name => !previousResponses.includes(name))
  const bestMatches = stringSimilarity.findBestMatch(file, episodes).ratings
  bestMatches.sort((first, second) => second.rating - first.rating)
  return ['skip', ...bestMatches.slice(0, 20).map(match => ({
    name: `${match.target} <${match.rating.toFixed(2)}>`,
    value: match.target,
  }))]
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
      if (response.data.data.length == 1)
        return response.data.data[0].id

      return inquirer.prompt({
        type: 'list',
        name: 'series',
        message: `Which series did you mean?`,
        choices: response.data.data.map(d => ({
          name: d.seriesName,
          value: d.id,
        })),
      })
      .then(answers => answers.series)
    })
    .then(seriesId => {
      return new Promise((resolve, reject) => {
        console.log(`get page 1`)
        const getPage = (prevEpisodes, page) => {
          api.get(`/series/${seriesId}/episodes`, {params: {page}}).then(result => {
            const episodes = [...prevEpisodes, ...result.data.data]
            if (result.data.links.next !== null) {
              console.log(`get page ${result.data.links.next} of ${result.data.links.last}`)
              return getPage(episodes, result.data.links.next)
            }
            resolve(episodes)
          }).catch(reject)
        };
        getPage([], 1)
      })
    })
  })
  .then(episodes => {
    // TODO: fuller episode/file names here
    return episodes
      .map(episode => episode.episodeName)
      .filter(name => name)
  })
}

function renameFiles(oldToNewPairs) {
  for (const from of Object.keys(oldToNewPairs)) {
    const to = oldToNewPairs[from]
    console.log(`rename ${from} to ${to}`)
  }
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
