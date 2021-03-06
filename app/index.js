const dotenv = require("dotenv");
const Bot = require("@dlghq/dialog-bot-sdk");
const {
    MessageAttachment,
    ActionGroup,
    Action,
    Select,
    SelectOption
} = require("@dlghq/dialog-bot-sdk");
const { flatMap } = require("rxjs/operators");
const axios = require("axios");
const { merge } = require("rxjs");
const moment = require("moment");
const fs = require('fs');

const USERS_ACTIVE_COMMAND = "active";
const USER_COMMAND = "progress";
const REMIND_COMMAND = "start";
const REMIND_STOP_COMMAND = "stop";
const NEW_TASK_COMMAND = "new";
const COMMENT_COMMAND = "comment";

const config = JSON.parse(fs.readFileSync("settings.json", "utf-8"));

const JIRA_URL = config["jiraUrl"];
const TIMEOUT = config["timeout"];
const MESSAGE_LENGTH = config["messageLength"];

const LANGUAGES = ['ru', 'en'];
const DEFAULT_LANG = 'en';
const LOCALE = {
    unknownProject: {
        en: "Unknown project code. Valid project codes: ",
        ru: "Неизвестный код проекта. Валидные коды: "
    },
    noUserTasks: {
        en: "You have no tasks in status \"In Progress\"",
        ru: "У Вас нет тасок со статусом \"In Progress\""
    },
    selectProject: {
        en: "Select the project you want to add the task:",
        ru: "Выберете проект, в котором хотите создать таску:"
    },
    completeComment: {
        en: "Comment has been added succesfully to the task",
        ru: "Комментарий успешно отправлен"
    },
    trackingOn: {
        en: "I'm tracking ${} for you.",
        ru: "Я отслеживаю ${} для Вас."
    },
    trackingAlready: {
        en: "I'm already tracking ${} for you.",
        ru: "Я уже отслеживаю ${} для Вас."
    },
    trackingOff: {
        en: "I'm stop tracking ${} for you.",
        ru: "Я перестал отслеживать ${} для Вас."
    },
    noTracking: {
        en: "I'm not tracking ${} for you.",
        ru: "Я не отслеживаю ${} для Вас."
    },
    noTask: {
        en: "No task ",
        ru: "Нет таски "
    },
    noDescription: {
        en: "Creating of an issue using project keys and issue type names using the REST API",
        ru: "Таска создана ботом через REST API"
    },
    assignee: {
        en: "assignee",
        ru: "исполнитель"
    },
    help: {
        en: "send commands:\n" +
            "`" + USERS_ACTIVE_COMMAND + " project_code` - for get all tasks in `project_code` project with status " +
            "\"In Progress\" (example `project_code` = `DP` Dialog Platform),\n" +
            "`" + USER_COMMAND + "` - for get your tasks with status \"In Progress\",\n" +
            "`" + REMIND_COMMAND + " task_id` - for start tracking change status for `task_id`,\n" +
            "`" + REMIND_STOP_COMMAND + " task_id` - for stop tracking change status for `task_id`,\n" +
            "`" + COMMENT_COMMAND + " task_id`\n" +
            "`comment_text` - for add comment to `task_id` with `comment_text`,\n" +
            "`" + NEW_TASK_COMMAND + "`\n" +
            "`title_text`\n" +
            "`description_text` - for create new task with title = `title_text` and description = `description_text`",
        ru: "отправьте одну из команд:\n" +
            "`" + USERS_ACTIVE_COMMAND + " project_code` - для получения всех тасок `project_code` проекта со статусом " +
            "\"In Progress\" (например, `project_code` = `DP` Dialog Platform),\n" +
            "`" + USER_COMMAND + "` - для получения ваших тасок в статусе \"In Progress\",\n" +
            "`" + REMIND_COMMAND + " task_id` - чтобы началать отслеживать статус таски по `task_id`,\n" +
            "`" + REMIND_STOP_COMMAND + " task_id` - чтобы остановить отслеживать статус таски `task_id`,\n" +
            "`" + COMMENT_COMMAND + " task_id`\n" +
            "`comment_text` - чтобы добавить комментарий `task_id` с текстом `comment_text`,\n" +
            "`" + NEW_TASK_COMMAND + "`\n" +
            "`title_text`\n" +
            "`description_text` - чтобы создать новую таску заголовок = `title_text` и описание = `description_text`"
    }
};

dotenv.config();

const credentials = config["user"] + ":" + config["password"];
const credsBase64 = Buffer.from(credentials).toString("base64");

const headers = {
    Authorization: "Basic " + credsBase64,
    "Content-Type": "application/json"
};

let fetchedProjects = {};
let jiraTaskTitle = {};
let jiraTaskDescription = {};
let peers = {};
let tasksToTrack = {};

//token to connect to the bot
const token = config["botToken"];
if (typeof token !== "string") {
  throw new Error("BOT_TOKEN env variable not configured");
}

//bot endpoint
const endpoint = config["botEndpoint"];

const bot = new Bot.default({
    token,
    endpoints: [endpoint]
});

async function run() {
    //fetching bot name
    const self = await bot.getSelf();
    console.log(credsBase64);
    console.log(`I've started, post me something @${self.nick}`);

    bot.updateSubject.subscribe({
        next(update) {
            console.log(JSON.stringify({update}, null, 2));
        }
    });

    searchJiraTasks().catch(err => console.log(`searchJiraTasks failed: ${err}`, err));

    //subscribing to incoming messages
    const messagesHandle = bot.subscribeToMessages().pipe(
        flatMap(async message => {
            console.log("MESSAGE", message);
            peers[message.peer.id] = message.peer;
            if (message.content.type === "text" && message.peer.type === "private") {
                const lang = await getCurrentUserLang(message.peer.id);
                const linesArray = message.content.text.split("\n");
                const command = linesArray[0];
                const selfSpace = String.fromCharCode(8291);  // with copy message from dialog enterprise
                const commandsArray = linesArray[0].split(selfSpace).join(" ").split(" ").filter(word => word !== "");
                const countLines = linesArray.length;
                if (commandsArray.length === 2 &&
                    commandsArray[0] === USERS_ACTIVE_COMMAND) {
                    let projectsArray = [];
                    await axios({
                        url: JIRA_URL + "/rest/api/2/project",
                        method: "get",
                        headers: headers
                    }).then(res => {
                        fetchedProjects[message.peer.id] = [];
                        res.data.forEach(project => {
                            projectsArray.push(project);
                        });
                    }).catch(err => console.log(`Jira request failed: ${err}`, err));
                    let validProject = false;
                    projectsArray.forEach(project => {
                        if (project.key === commandsArray[1]) validProject = true;
                    });
                    if (!validProject) {
                        return sendText(message.peer,
                            LOCALE.unknownProject[lang] + "`" + projectsArray.map(getProjectKey).join("`, `") + "`")
                    }
                    let urls = JIRA_URL + "/rest/api/2/search?jql=project=" +
                        commandsArray[1] +
                        "%20AND%20status=\"In+Progress\"&maxResults=100";
                    let result = await axios({
                        url: urls,
                        method: "get",
                        headers: headers
                    })
                        .then(response => {
                            let groupedTasks = {};
                            response.data.issues.forEach(issue => {
                                const creator = issue.fields.creator.displayName;
                                if (!groupedTasks.hasOwnProperty(creator.toString())) groupedTasks[creator.toString()] = [];
                                groupedTasks[creator.toString()].push(formatJiraText(issue, lang));
                            });
                            sendGroupedTasks(message.peer, groupedTasks)
                        })
                        .catch(err => console.log(`Command ${USERS_ACTIVE_COMMAND} failed.\nJira request failed: ${err}`, err));
                } else if (command === USER_COMMAND) {
                    getCurrentUserNick(message.peer)
                        .then(user => {
                            axios({
                                url: JIRA_URL +
                                    "/rest/api/2/search?jql=status=\"In+Progress\"%20AND%20assignee=" +
                                    user,
                                method: "get",
                                headers: headers
                            })
                                .then(response => {
                                    let groupedTasks = {};
                                    if (response.data.issues.length > 0) {
                                        const str = response.data.issues.forEach(issue => {
                                            const creator = issue.fields.creator.displayName;
                                            if (!groupedTasks.hasOwnProperty(creator.toString())) groupedTasks[creator.toString()] = [];
                                            groupedTasks[creator.toString()].push(formatJiraText(issue, lang));
                                        });
                                        sendGroupedTasks(message.peer, groupedTasks)
                                    } else {
                                        sendText(message.peer, LOCALE.noUserTasks[lang]);
                                    }
                                })
                                .catch(err => console.log(`Command ${USER_COMMAND} failed.\nJira request failed: ${err}`, err))
                        })
                        .catch(err => console.log(`getUser failed: ${err}`, err));
                } else if (countLines > 1 && command === NEW_TASK_COMMAND) {
                    jiraTaskTitle[message.peer.id] = linesArray[1];
                    jiraTaskDescription[message.peer.id] = "";
                    for (let i = 2; i < countLines; i++) {
                        jiraTaskDescription[message.peer.id] = jiraTaskDescription[message.peer.id] + linesArray[i] + "\n"
                    }
                    await axios({
                        url: JIRA_URL + "/rest/api/2/project",
                        method: "get",
                        headers: headers
                    }).then(res => {
                        fetchedProjects[message.peer.id] = [];
                        console.log("res",res.data);
                        res.data.forEach(project => {
                            fetchedProjects[message.peer.id].push(project);
                        });
                    }).catch(err => console.log(`Command ${NEW_TASK_COMMAND} failed.\nJira request failed: ${err}`, err));

                    //creating dropdown of available project options
                    const dropdownActions = [];
                    dropdownActions.push();
                    fetchedProjects[message.peer.id].forEach(project => {
                        dropdownActions.push(new SelectOption(project.name, project.name));
                    });

                    //adding stop button to the actions

                    // returning the projects to the messenger
                    const mid = await sendText(
                        message.peer,
                        LOCALE.selectProject[lang],
                        MessageAttachment.reply(message.id),
                        ActionGroup.create({
                            actions: [
                                Action.create({
                                    id: `projects`,
                                    widget: Select.create({
                                        label: "Projects",
                                        options: dropdownActions
                                    })
                                })
                            ]
                        })
                    );
                } else if (countLines > 1 &&
                    commandsArray.length === 2 &&
                    commandsArray[0] === COMMENT_COMMAND) {
                    const issue = commandsArray[1];
                    const commentUrl =
                        JIRA_URL + "/rest/api/2/issue/" + issue + "/comment";
                    let comment = "";
                    for (let i = 1; i < countLines; i++) comment = comment + linesArray[i] + "\n";
                    if (comment !== "") {
                        const bodyData = {
                            body: comment
                        };
                        const postIssueToJira = await axios({
                            url: commentUrl,
                            method: "post",
                            headers: headers,
                            data: bodyData
                        }).catch(err => console.log(`Command ${COMMENT_COMMAND} failed.\nJira request failed: ${err}`, err));

                        sendText(message.peer, LOCALE.completeComment[lang]);
                    }
                } else if (commandsArray[0] === REMIND_COMMAND && commandsArray.length === 2) {
                    let result = await axios({
                        url: JIRA_URL + "/rest/api/2/issue/" + commandsArray[1],
                        method: "get",
                        headers: headers
                    })
                        .then(response => {
                            const issue = {
                                task: response.data.key,
                                status: response.data.fields.status.name
                            };
                            if (tasksToTrack[message.peer.id] === undefined) tasksToTrack[message.peer.id] = [];
                            if (containsValue(tasksToTrack[message.peer.id], commandsArray[1])) {
                                sendText(message.peer, format(LOCALE.trackingAlready[lang], [commandsArray[1]]));
                            } else {
                                tasksToTrack[message.peer.id].push(issue);
                                sendText(message.peer, format(LOCALE.trackingOn[lang], [commandsArray[1]]));
                            }
                        })
                        .catch(err => {
                            console.log(`Command ${REMIND_COMMAND} failed.\nJira request failed: ${err}`, err);
                            if (err.response.status === 404)
                                bot.sendText(message.peer, LOCALE.noTask[lang] + [commandsArray[1]]);

                        });
                } else if (commandsArray[0] === REMIND_STOP_COMMAND && commandsArray.length === 2) {
                    if (tasksToTrack[message.peer.id] === undefined) tasksToTrack[message.peer.id] = [];
                    if (containsValue(tasksToTrack[message.peer.id], commandsArray[1])) {
                        tasksToTrack[message.peer.id] = removeValue(tasksToTrack[message.peer.id], commandsArray[1]);
                        sendText(message.peer, format(LOCALE.trackingOff[lang], [commandsArray[1]]));
                    } else {
                        sendText(message.peer, format(LOCALE.noTracking[lang], [commandsArray[1]]));
                    }
                } else {
                    sendText(message.peer, LOCALE.help[lang]);
                }
            }
        })
    );

    const actionsHandle = bot.subscribeToActions().pipe(
        flatMap(async event => {
            const projectToPost = await fetchedProjects[event.uid].filter(
                project => project.name === event.value
            );
            const lang = await getCurrentUserLang(event.uid);
            let description = jiraTaskDescription[event.uid] || LOCALE.noDescription[lang];

            const dataToPost = {
                fields: {
                    project: {
                        key: projectToPost[0].key
                    },
                    summary: jiraTaskTitle[event.uid],
                    description: description,
                    issuetype: {
                        name: "Task"
                    }
                }
            };

            //creating the issue in JIRA
            const postIssueToJira = await axios({
                url: JIRA_URL + "/rest/api/2/issue",
                method: "post",
                headers: headers,
                data: dataToPost
            }).catch(err => `Jira request failed: ${err}`);

            // return the response to messenger
            const responseText = formatJiraTextForProject(
                postIssueToJira.data,
                projectToPost[0],
                jiraTaskTitle[event.uid]
            );

            sendText(peers[event.uid], responseText);

            //resetting the variables
            delete fetchedProjects[event.uid];
            delete jiraTaskTitle[event.uid];
            delete jiraTaskDescription[event.uid];
        })
    );

    await new Promise((resolve, reject) => {
        merge(messagesHandle, actionsHandle).subscribe({
            error: reject,
            complete: resolve
        });
    });
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});

function formatJiraText(issue, lang) {
    const timeInProgress = moment(issue.fields.updated).fromNow();
    const taskId = issue.key;
    const taskTitle = issue.fields.summary;
    let assignee = "";
    if (issue.fields.assignee !== null) {
        assignee = ` (${LOCALE.assignee[lang]} ` + issue.fields.assignee.displayName.toString() + ")";
    }
    const outputFormat =
        timeInProgress + " - " + "[" + taskId + "](" + JIRA_URL + "/browse/" + taskId + ") : " + taskTitle + assignee;
    return outputFormat;
}

function formatJiraTextForProject(task, project, jiraTaskTitle) {
    const outputFormat =
        "[" + task.key + "](" + JIRA_URL + "/browse/" + task.key + ") : " + jiraTaskTitle;
    return outputFormat;
}

function formatJiraTextForChange(issue) {
    const status = issue.fields.status.name;
    const taskId = issue.key;
    const taskUrl = issue.self;
    const taskTitle = issue.fields.summary;
    const outputFormat =
        status + " - " + "[" + taskId + "](" + taskUrl + ") : " + taskTitle;
    return outputFormat;
}

async function sendGroupedTasks(peer, sortedTasks) {
    let blocks = "";
    let jiraResponse = "";
    const users = Object.keys(sortedTasks);
    users.forEach(function (key, index) {
        jiraResponse += "\n" + key + "\n";
        sortedTasks[key].map(task => {
            jiraResponse += task + "\n";
        });
        if (blocks.length + jiraResponse.length > MESSAGE_LENGTH) {
            sendText(peer, blocks);
            blocks = jiraResponse;
            jiraResponse = "";
        }
        blocks = blocks + jiraResponse;
    });
    await sendText(peer, blocks);
}

async function getCurrentUserNick(peer) {
    const user = await bot.getUser(peer.id);
    return user.nick;
}

async function getCurrentUserLang(uid) {
    const user = await bot.loadFullUser(uid);
    let res = "";
    user.preferredLanguages
        .map(l => l.toLowerCase().trim().replace('-', '_').split('_')[0])
        .forEach(lang =>
            LANGUAGES.forEach(default_lang => {
                if (lang === default_lang) res = lang;
            })
        );
    return res || DEFAULT_LANG;
}

function containsValue(array, value) {
    let valuePresent = false;
    array.forEach(object => {
        if (object.task === value) {
            valuePresent = true;
        }
    });
    return valuePresent;
}

function issueStatus(key, uid) {
    let status = "";
    tasksToTrack[uid].forEach(taskTracked => {
        if (taskTracked.task === key) {
            status = taskTracked.status;
        }
    });
    return status;
}

function removeValue(arr, value) {
    for(let i = 0; i < arr.length; i++) {
        if(arr[i] === value) {
            arr[i] = arr[0];
            return arr.splice(1);
        }
    }
}

function getProjectKey(project) {
    return project.key
}

async function sendText(peer, text, attach, actions) {
    bot.sendText(peer, text, attach, actions).catch(err => console.log(`sandText failed: ${err}`, err));
}

function format(template, args) {
    const teml = template.split("${}");
    let res = teml[0];
    for (let i=0; i < args.length; i++) {
        res +=  args[i] + teml[i+1];
    }
    return res
}

async function searchJiraTasks() {
    updateJiraTasks().then(_ => setTimeout(searchJiraTasks, TIMEOUT)).catch(err => console.log(`updateJiraTasks failed: ${err}`, err))
}

async function updateJiraTasks() {
    for (let key in tasksToTrack) {
        if (tasksToTrack[key] !== undefined) {
            for (let i = 0; i < tasksToTrack[key].length; i++) {
                let result = await axios({
                    url: JIRA_URL + "/rest/api/2/issue/" + tasksToTrack[key][i]["task"],
                    method: "get",
                    headers: headers
                }).then(response => {
                    let data = response.data;
                    if (data.fields.status.name !== issueStatus(data.key, key)) {
                        tasksToTrack[key].map(task => {
                            if (task.task === data.key) {
                                task.status = data.fields.status.name;
                                sendText(peers[key], formatJiraTextForChange(data));
                            }
                        });
                    }
                }).catch(err => console.log(`Jira request failed: ${err}`, err));
            }
        }
    }
}