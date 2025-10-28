import { Database } from 'sqlite3'
import { existsSync, mkdirSync, rmSync } from 'fs';
import * as fs from 'fs'
import { basename, dirname, relative } from 'path'

import JSONdb = require('simple-json-db')
import download = require('download')
import StreamZip = require('node-stream-zip')

import { logger } from './publiclogger'


import { IBeatmapSubmission, IUserInfo } from './data'

// Setup our folder structure
if (!existsSync('db'))
    mkdirSync('db');
if (!existsSync('db/public'))
    mkdirSync('db/public');
if (!existsSync('db/public/packages'))
    mkdirSync('db/public/packages');
if (!existsSync('db/private'))
    mkdirSync('db/private');

const packages = new JSONdb('./db/public/packages.json');
const submissions = new JSONdb('./db/public/submissions.json');
const users = new JSONdb('./db/private/users.json')
const highscores = new JSONdb('./db/public/highscores.json')
const lowscores = new JSONdb('./db/public/lowscores-hidden.json')

if (!packages.has('packages'))
    packages.set('packages', [])

interface IBeatmap {
    name : string,
    artist : string,
    creator: string,
    difficulty: string,
    internalDifficulty: string,
    audioFileName: string,
    file: string
    tags: string
}
interface zzzIBeatmapPackage {
    name: string,
    guid: string,
    filePath: string,
    time: Date,
    beatmaps: {[bmapFilePath: string] : IBeatmap}
}
interface IBeatmapHighScore {
    score: number
    accuracy: number
    fc: number
}

interface IPackage {
    name: string,
	mappers?: string,
	artists?: string,
    guid: string,
    filePath: string,
    time: Date,
    //songs: [ISong]
    songs: Array<IBeatmap>[]
}
interface ISong {
    beatmaps: Array<IBeatmap>
}

interface IZipPackage {
    Name: string,
    Mappers: string,
    Artists: string,
    GUID: string,
    Songs: IZipSong[]
}

interface IZipSong {
    Beginner?: string
    Normal?: string
    Hard?: string
    Expert?: string
    UNBEATABLE?: string
    Star?: string
}


const getBeatmapProp = (osu : string, label : string) => {
    const match = osu.match(`${label}: *(.+?)\r?\n`);
    if (!!match && match.length >= 1)
        return match[1]
    return ""
}
/*
const parseBeatmapString = (osu : string) : IBeatmap => {
    let audioFilename = getBeatmapProp(osu, "AudioFilename")
    if (audioFilename.startsWith("USER_BEATMAPS/")) {
        audioFilename = audioFilename.substring("USER_BEATMAPS/".length)
    }
    return {
        name: getBeatmapProp(osu, "TitleUnicode"),
        artist: getBeatmapProp(osu, "Artist"),
        creator: getBeatmapProp(osu, "Creator"),
        difficulty: getBeatmapProp(osu, "Version"),
        internalDifficulty: getBeatmapProp(osu, "Version"),
        audioFileName: audioFilename
    }
}
*/
const parseBeatmapString = (osu : string, bmap : IBeatmap) : IBeatmap => {
    let audioFilename = getBeatmapProp(osu, "AudioFilename")
    if (audioFilename.startsWith("USER_BEATMAPS/")) {
        audioFilename = audioFilename.substring("USER_BEATMAPS/".length)
    }

    
    return {
    name: getBeatmapProp(osu, "TitleUnicode"),
    artist: getBeatmapProp(osu, "Artist"),
    creator: getBeatmapProp(osu, "Creator"),
    difficulty: getBeatmapProp(osu, "Version"),
    internalDifficulty: bmap.internalDifficulty,
    audioFileName: audioFilename,
    file: bmap.file,
    tags: getBeatmapProp(osu, "Tags"),
}
}

const parseBeatmapPackage = (difficulty : string, file : string) : IBeatmap => {
    
    return {
    name: '',
    artist: '',
    creator: '',
    difficulty: '',
    internalDifficulty: difficulty,
    audioFileName: '',
    file: file,
    tags: ''
}
}
/*
const parseZipEntry = (zip: any, entryPath : string, getBeatmap: (beatmap: IBeatmap) => void) => {
    return new Promise<void>(resolve => {
        if (entryPath.endsWith('.osu')) {
            zip.stream(entryPath).then((stm : any) => {
                logger.info("STREAMING", entryPath)
                let result = ''
                stm.on('data', (chunk : string) => {
                    result += chunk
                })
                stm.on('end', () => {
                    const newBeatmap = parseBeatmapString(result, entryPath);
                    logger.info("GOT: ", newBeatmap)
                    getBeatmap(newBeatmap)
                    resolve()
                });
            })
        } else {
            resolve()
        }
    })
}
*/
const parseZipEntry = (zip: any, entryPath : string, beatmap: IBeatmap, getBeatmap: (beatmap: IBeatmap) => void) => {
    return new Promise<void>(resolve => {
        if (entryPath.endsWith('.osu')) {
            zip.stream(entryPath).then((stm : any) => {
                logger.info("STREAMING", entryPath)
                let result = ''
                stm.on('data', (chunk : string) => {
                    result += chunk
                })
                stm.on('end', () => {
                    const newBeatmap = parseBeatmapString(result, beatmap);
                    //beatmap = newBeatmap;
                    logger.info("GOT: ", newBeatmap)
                    getBeatmap(newBeatmap)
                    resolve()
                });
            })
        } else {
            resolve()
        }
    })
}

const parseZipPackage = (zip: any, entryPath : string, iBmap: IPackage) => {
    return new Promise<void>(resolve => {
        if (entryPath.endsWith('.bmap')) {
            zip.stream(entryPath).then((stm : any) => {
                logger.info("STREAMING", entryPath)
                let result = ''
                stm.on('data', (chunk : string) => {
                    result += chunk
                })
                stm.on('end', () => {
                    //const newBeatmap = parseBeatmapString(result);
                    const pkg: IZipPackage = JSON.parse(result);
                    logger.info("GOT: ", pkg)
                    iBmap.guid = pkg.GUID;
                    iBmap.name = pkg.Name;
					iBmap.mappers = pkg.Mappers;
					iBmap.artists = pkg.Artists;
                    // Do stuff for beatmaps this points to
                    //console.log(pkg)
                    for (let i = 0; i < pkg.Songs.length; ++i) {
                        iBmap.songs.push([])
                        
                        // NOTE: this is terrible
                        if (pkg.Songs[i]["Beginner"] != undefined) {
                            let song : string = pkg.Songs[i]["Beginner"] === undefined ? "ERROR" : pkg.Songs[i]["Beginner"]
                            iBmap.songs[i].push(parseBeatmapPackage("Beginner", song));
                        }
                        if (pkg.Songs[i]["Normal"] != undefined) {
                            let song : string = pkg.Songs[i]["Normal"] === undefined ? "ERROR" : pkg.Songs[i]["Normal"]
                            iBmap.songs[i].push(parseBeatmapPackage("Normal", song));
                        }
                        if (pkg.Songs[i]["Hard"] != undefined) {
                            let song : string = pkg.Songs[i]["Hard"] === undefined ? "ERROR" : pkg.Songs[i]["Hard"]
                            iBmap.songs[i].push(parseBeatmapPackage("Hard", song));
                        }
                        if (pkg.Songs[i]["Expert"] != undefined) {
                            let song : string = pkg.Songs[i]["Expert"] === undefined ? "ERROR" : pkg.Songs[i]["Expert"]
                            iBmap.songs[i].push(parseBeatmapPackage("Expert", song));
                        }
                        if (pkg.Songs[i]["UNBEATABLE"] != undefined) {
                            let song : string = pkg.Songs[i]["UNBEATABLE"] === undefined ? "ERROR" : pkg.Songs[i]["UNBEATABLE"]
                            iBmap.songs[i].push(parseBeatmapPackage("UNBEATABLE", song));
                        }
                        if (pkg.Songs[i]["Star"] != undefined) {
                            let song : string = pkg.Songs[i]["Star"] === undefined ? "ERROR" : pkg.Songs[i]["Star"]
                            iBmap.songs[i].push(parseBeatmapPackage("Star", song));
                        }

                    }
                    
                    //getPackage(iBmap)
                    resolve()
                });
            })
        } else {
            resolve()
        }
    })
}



// We also keep track of submissions so we can easily test them from the game.
export const registerSubmission = (submission : IBeatmapSubmission) => {
    logger.info("NEW SUBMISSION: ", submission)
    const name = submission.fileName
    const localURL = "submissions/" + name
    downloadFile(submission.downloadURL, "db/public/" + localURL, false).then(filename => {
        // TODO: Update CustomBeatmaps client to prepend this...
        const globalURL = "http://64.225.60.116:8080/" + localURL

        let resultSubmission = {...submission, fileName : name, downloadURL : globalURL}
        submissions.set(name, resultSubmission)
    })
    
}
export const deleteSubmission = (filename: string) => {
    logger.info("DELETE SUBMISSION: ", filename)
    let localPath = submissions.get(filename) as any
    if (!!localPath && !!localPath["fileName"]) {
        const filePath = 'db/public/submissions/' + localPath["fileName"]
        if (existsSync(filePath)) {
            rmSync(filePath)
            logger.info(`   (also deleted file at ${filePath})`)
        }
    }
    submissions.delete(filename)
}

export const registerZipPackage = async (zipFilePath : string, time : Date | undefined = undefined) => {

    const fileStats = await fs.promises.stat(zipFilePath)

    const resultingPackage : IPackage = {
        name: "FIXME",
        guid: "FIXME",
        filePath: zipFilePath.startsWith("db/public/") ? zipFilePath.substr(10) : zipFilePath,
        time: !!time ? time : fileStats.birthtime,
        songs: new Array<Array<IBeatmap>>
    }

    const zip = await new StreamZip.async({ file: zipFilePath })
    const entries = Object.values(await zip.entries())
    

    // Find the .bmap files    
    for (const entry of entries) {
        if (!entry.isDirectory && entry.name.endsWith(".bmap")) {
            await parseZipPackage(zip, entry.name, resultingPackage)
            //await parseZipPackage(zip, entry.name, resultingPackage, resultingPackage => resultingPackage)
            //await parseZipEntry(zip, entry.name, beatmap => resultingPackage.beatmaps[entry.name] = beatmap)
        }
    }

    //Find the .osu files
    for (const entry of entries) {
        if (!entry.isDirectory && entry.name.endsWith(".osu")) {

            const songIndex = resultingPackage.songs.findIndex((song) => song.find((value) => entry.name.endsWith(value.file)))
            console.log("Song Index:" + songIndex)
            let bmapIndex = -1;
            if (songIndex > -1) {
                bmapIndex = resultingPackage.songs[songIndex].findIndex((value) => entry.name.endsWith(value.file))
                console.log("Beatmap Index:" + bmapIndex)
            }
            

            console.log("entry test: " + entry.name)
            //const found = resultingPackage.songs[0].beatmaps.find((value) => entry.name.endsWith(value.file))

            //console.log(resultingPackage.songs[songIndex].beatmaps[bmapIndex])
            //console.log("FOUND: " + resultingPackage.songs[songIndex].beatmaps[bmapIndex].file + " : " + entry.name)
            //await parseZipEntry(zip, entry.name, beatmap => resultingPackage.songs[songIndex].beatmaps[bmapIndex] = beatmap)
            await parseZipEntry(zip, entry.name, resultingPackage.songs[songIndex][bmapIndex], beatmap => resultingPackage.songs[songIndex][bmapIndex] = beatmap)
        }
    }


    // Close zip file reading
    await zip.close();
    // Update database
    let currentPackages : IPackage[] | undefined = <IPackage[]>packages.get('packages')
    packages.set('packages', !!currentPackages? [...currentPackages, resultingPackage ] : [resultingPackage])
}

// Will reload `packages.json` based on the beatmap files in `packages`
export const refreshDatabase = async () => {
    logger.info("REFRESHING DATABASE")
    // Preserve dates
    const dates : any = {}
    const pkgs : any = packages.get("packages")
    for (const pkg of pkgs) {
        dates[pkg.filePath] = pkg.time
    }
    // Clear packages
    packages.JSON({})
    const files = await fs.promises.readdir('db/public/packages');
    for (const file of files) {
        const filename = 'db/public/packages/' + file
        logger.info("   ", filename)
        // Try to preserve dates
        const date = dates['packages/' + file]
        await registerZipPackage(filename, date)
    }
}

// TODO: Big code duplication for these two

export const changeDate = (url : string, time : Date) => {
    const filePathKey = "packages/" + basename(new URL(url).pathname)
    const pkgs : any | undefined = packages.get("packages")
    if (!pkgs)
        return
    for (let i = 0; i < pkgs.length; ++i) {
        const pkg : any = pkgs[i]
        if (pkg.filePath === filePathKey) {
            logger.info("Updated date for", filePathKey, ":", time)
            pkgs[i] = {
                ...pkg,
                time: time
            }
        }
    }
    packages.set("packages", pkgs)
}

export const packageDownloaded = (url : string) : boolean => {
    const filePathKey = "packages/" + basename(new URL(url).pathname)
    const pkgs : any | undefined = packages.get("packages")
    if (!pkgs)
        return false
    for (const pkg of pkgs) {
        if (pkg.filePath === filePathKey) {
            return true
        }
    }
    return false
}

const downloadFile = (url : string, defaultFilename : string, versioning : boolean) : Promise<string> => {
    return new Promise<string>((resolve, reject) => {
        let filename = defaultFilename
        // Make unique in the event that there are duplicates
        if (versioning && existsSync(filename)) {
            let ver = 1 // start at ver2
            let checkname
            do {
                ver += 1
                checkname = filename + "_ver" + ver
            } while (existsSync(checkname))
            filename = checkname
        }

        download(url, dirname(filename), {filename: basename(filename)}).then(() => resolve(filename))
    });
}

export const downloadBeatmapPackage = (url : string, name : string, time : Date | undefined = undefined) : Promise<void> => {
    const desiredFilename = 'db/public/packages/' + name
    logger.info("DOWNLOADING PACKAGE: ", url, " => ", desiredFilename)
    return downloadFile(url, desiredFilename, true).then(async (filename) => {
        logger.info("        downloaded: ", filename)
        // We have a new zip file, register it.
        await registerZipPackage(filename, time)
    });
}

export const deletePackage = (packageFileName : string) : Promise<void> => {
    return new Promise<void>((resolve, reject) => {
        const filename = 'db/public/packages/' + packageFileName
        const packageFilepath = 'packages/' + packageFileName
        const list : IPackage[] = packages.get('packages') as IPackage[]
        if (!list) {
            reject("DB broken")
            return
        }
        logger.info("DELETING PACKAGE ", packageFileName)
        if (existsSync(filename)) {
            rmSync(filename)
            logger.info(`   (file at ${filename})`)
        } else {
            logger.info(`   (NO FILE FOUND at ${filename})`)    
        }
        const filtered = list.filter(pkg => pkg.filePath != packageFilepath)
        if (filtered.length == list.length) {
            logger.info(`   (NO PACKAGES FOUND with path ${packageFilepath})`)
        } else {
            packages.set('packages', filtered)
            logger.info(`   (deleted ${list.length - filtered.length} package entries)`)
        }
    })
}

// Credits to https://stackoverflow.com/questions/7616461/generate-a-hash-from-string-in-javascript
const cyrb53 = function(str : string, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1>>>16), 2246822507) ^ Math.imul(h2 ^ (h2>>>13), 3266489909);
    h2 = Math.imul(h2 ^ (h2>>>16), 2246822507) ^ Math.imul(h1 ^ (h1>>>13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1>>>0);
};

const generateUniqueUserId = (username : string) : string => {
    let hash : string = cyrb53(username).toString()
    while (users.has(hash)) {
        hash = cyrb53(hash).toString()
    }
    return hash
}

export const registerNewUser = (username : string) : Promise<string> => {
    return new Promise((resolve, reject) => {

        // Usernames must be unique
        if (!!Object.values(users.JSON()).find((userData : any) => userData["name"].toLowerCase() === username.toLowerCase())) {
            reject("Username already taken!");
            return;
        }

        const newUniqueId = generateUniqueUserId(username)
        const newUserData : IUserInfo = {name: username, registered: new Date()}
        // private pls
        logger.info("NEW USER:", username)
        console.log("NEW USER: ", username, " => ", newUserData)
        users.set(newUniqueId, newUserData)
        resolve(newUniqueId)
    })
}

export const getUserInfo = (uniqueUserId : string) : Promise<IUserInfo> => {
    return new Promise((resolve, reject) => {
        if (users.has(uniqueUserId)) {
            const result = users.get(uniqueUserId) as IUserInfo
            resolve(result)
        } else {
            reject("No user with given id found.")
        }
    })
}

// Manually set our high score
const setScore = (db : any, beatmapKey: string, username : string, score : IBeatmapHighScore) : Promise<void> => {
    return new Promise((resolve, reject) => {
        const toSet : any = db.get(beatmapKey) ?? {}
        toSet[username] = score
        db.set(beatmapKey, toSet)
        resolve()
    })
}

const tryRegisterScore = (db: any, beatmapKey : string, username : string, score : IBeatmapHighScore, accept : (score : IBeatmapHighScore, prevRecord : IBeatmapHighScore) => boolean) : Promise<void> => {
    return new Promise((resolve, reject) => {
        const beatmapRecords = db.get(beatmapKey)
        const prevRecord : IBeatmapHighScore = !!beatmapRecords ? beatmapRecords[username] : undefined
        logger.info("        (prev record: ", prevRecord, ")")
        if (!!prevRecord && !!prevRecord.score) {
            if (accept(score, prevRecord)) {
                return setScore(db, beatmapKey, username, score).then(() => resolve())
            } else {
                resolve()
            }
        } else {
            logger.info("        new: ", score.score)
            return setScore(db, beatmapKey, username, score).then(() => resolve())
        }
    });
}

const registerScoreUsername = (beatmapKey : string, username : string, score : IBeatmapHighScore) : Promise<void> => {
    logger.info("GOT SCORE:", username, beatmapKey, score)
    return tryRegisterScore(highscores, beatmapKey, username, score, (score, record) => score.score > record.score)
    .then(() => tryRegisterScore(lowscores, beatmapKey, username, score, (score, record) => score.score < record.score))
}

/**
 * Registers a user score
 * 
 * @param packageFilePath The package filepath (ex. packages/...zip)
 * @param beatmapIndex The integer index within the package of WHICH beatmap was played
 * @param uniqueUserId The unique/private id of a user
 * @param score
 * @returns A Promise of whether or not the user got a new high score
 */
export const registerScoreUserId = (beatmapKey : string, uniqueUserId : string, score : IBeatmapHighScore) : Promise<void> => {
    beatmapKey = beatmapKey.replaceAll("\\", "/")
    return getUserInfo(uniqueUserId).then(userInfo => registerScoreUsername(beatmapKey, userInfo.name, score))
}
