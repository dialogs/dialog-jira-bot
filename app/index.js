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

const USERS_ACTIVE_COMMAND = "active";
const USER_COMMAND = "progress";
const REMIND_COMMAND = "start";
const REMIND_STOP_COMMAND = "stop";
const NEW_TASK_COMMAND = "new";
const COMMENT_COMMAND = "comment";

const TIMEOUT = Number.parseInt(process.env.TIMEOUT);
const MESSAGE_LENGTH = Number.parseInt(process.env.MESSAGE_LENGTH);

const LANGUAGES = ['ru', 'en'];
const DEFAULT_LANG = 'en';
const LOCALE = {
    unknownProject: {
        en: "Unknown project code. Valid project codes: ",
        ru: "Неизвестный код проекта. Валидные коды: "
    },
    noUserTasks: {
        en: "You has no tasks in status \"In Progress\"",
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

const credentials = process.env.JIRA_USERNAME + ":" + process.env.JIRA_PASSWORD;
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
const token = process.env.BOT_TOKEN;
if (typeof token !== "string") {
  throw new Error("BOT_TOKEN env variable not configured");
}

//bot endpoint
const endpoint = process.env.BOT_ENDPOINT;

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

    searchJiraTasks();

    //subscribing to incoming messages
    const messagesHandle = bot.subscribeToMessages().pipe(
        flatMap(async message => {
            console.log("MESSAGE", message);
            peers[message.peer.id] = message.peer;

            if (message.content.type === "text") {
                const lang = await getCurrentUserLang(bot, message.peer.id);
                const wordsArray = message.content.text.split("\n");
                const command = wordsArray[0];
                const commandsArray = wordsArray[0].split(" ");
                const len = wordsArray.length;
                if (commandsArray.length === 2 &&
                    commandsArray[0] === USERS_ACTIVE_COMMAND) {
                    let projectsArray = [];
                    await axios({
                        url: process.env.JIRA_URL + "/rest/api/2/project",
                        method: "get",
                        headers: headers
                    }).then(res => {
                        fetchedProjects[message.peer.id] = [];
                        res.data.forEach(project => {
                            projectsArray.push(project);
                        });
                    }).catch(err => console.log("err", err));
                    let validProject = false;
                    projectsArray.forEach(project => {
                        if (project.key === commandsArray[1]) validProject = true;
                    });
                    if (!validProject) {
                        return sendText(bot, message.peer,
                            LOCALE.unknownProject[lang] + "`" + projectsArray.map(getProjectKey).join("`, `") + "`")
                    }
                    let urls = process.env.JIRA_URL + "/rest/api/2/search?jql=project=" +
                        commandsArray[1] +
                        "%20AND%20status=\"In+Progress\"&maxResults=100";
                    let result = await axios({
                        url: urls,
                        method: "get",
                        headers: headers
                    })
                        .then(response => {
                            let sortedTasks = {};
                            response.data.issues.map(issue => {
                                const creator = issue.fields.creator.displayName;
                                if (!sortedTasks.hasOwnProperty(creator.toString())) sortedTasks[creator.toString()] = [];
                                sortedTasks[creator.toString()].push(formatJiraText(issue, lang));
                            });
                            sendSortTasks(bot, message.peer, sortedTasks)
                        })
                        .catch(err => console.log(err));
                } else if (command === USER_COMMAND) {
                    getCurrentUserNick(bot, message.peer)
                        .then(user => {
                            axios({
                                url: process.env.JIRA_URL +
                                    "/rest/api/2/search?jql=status=\"In+Progress\"%20AND%20assignee=" +
                                    user,
                                method: "get",
                                headers: headers
                            })
                                .then(response => {
                                    if (response.data.issues.length > 0) {
                                        formatJiraText(response.data.issues, lang);
                                    } else {
                                        sendText(bot, message.peer, LOCALE.noUserTasks[lang]);
                                    }
                                })
                                .catch(err => {
                                    console.log(err);
                                })
                        })
                        .catch(err => console.log(err));
                } else if (len > 1 && command === NEW_TASK_COMMAND) {
                    jiraTaskTitle[message.peer.id] = wordsArray[1];
                    jiraTaskDescription[message.peer.id] = "";
                    for (let i = 2; i < len; i++) {
                        jiraTaskDescription[message.peer.id] = jiraTaskDescription[message.peer.id] + wordsArray[i] + "\n"
                    }
                    const projects = await axios({
                        url: process.env.JIRA_URL + "/rest/api/2/project",
                        method: "get",
                        headers: headers
                    }).then(res => {
                        fetchedProjects[message.peer.id] = [];
                        res.data.forEach(project => {
                            fetchedProjects[message.peer.id].push(project);
                        });
                    }).catch(err => console.log("err", err));

                    //creating dropdown of available project options
                    const dropdownActions = [];
                    dropdownActions.push();
                    fetchedProjects[message.peer.id].forEach(project => {
                        dropdownActions.push(new SelectOption(project.name, project.name));
                    });

                    //adding stop button to the actions

                    // returning the projects to the messenger
                    const mid = await sendText(
                        bot,
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
                } else if (len > 1 &&
                    commandsArray.length === 2 &&
                    commandsArray[0] === COMMENT_COMMAND) {
                    const issue = commandsArray[1];
                    const commentUrl =
                        process.env.JIRA_URL + "/rest/api/2/issue/" + issue + "/comment";
                    let comment = "";
                    for (let i = 1; i < len; i++) comment = comment + wordsArray[i] + "\n";
                    if (comment !== "") {
                        const bodyData = {
                            body: comment
                        };
                        const postIssueToJira = await axios({
                            url: commentUrl,
                            method: "post",
                            headers: headers,
                            data: bodyData
                        });

                        sendText(bot, message.peer, LOCALE.completeComment[lang]);
                    }
                } else if (commandsArray[0] === REMIND_COMMAND && commandsArray.length === 2) {
                    let result = await axios({
                        url: process.env.JIRA_URL + "/rest/api/2/issue/" + commandsArray[1],
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
                                sendText(bot, message.peer, format(LOCALE.trackingAlready[lang], [commandsArray[1]]));
                            } else {
                                tasksToTrack[message.peer.id].push(issue);
                                sendText(bot, message.peer, format(LOCALE.trackingOn[lang], [commandsArray[1]]));
                            }
                        })
                        .catch(err => {
                            console.log(err);
                            bot.sendText(bot, message.peer, LOCALE.noTask[lang] + [commandsArray[1]]);

                        });
                } else if (commandsArray[0] === REMIND_STOP_COMMAND && commandsArray.length === 2) {
                    if (tasksToTrack[message.peer.id] === undefined) tasksToTrack[message.peer.id] = [];
                    console.log("logs", containsValue(tasksToTrack[message.peer.id], commandsArray[1]));
                    if (containsValue(tasksToTrack[message.peer.id], commandsArray[1])) {
                        tasksToTrack[message.peer.id] = removeValue(tasksToTrack[message.peer.id], commandsArray[1]);
                        sendText(bot, message.peer, format(LOCALE.trackingOff[lang]), [commandsArray[1]]);
                    } else {
                        sendText(bot, message.peer, format(LOCALE.noTracking[lang]), [commandsArray[1]]);
                    }
                } else {
                    sendText(bot, message.peer, LOCALE.help[lang]);
                }
            }
        })
    );

    const actionsHandle = bot.subscribeToActions().pipe(
        flatMap(async event => {
            const projectToPost = await fetchedProjects[[event.uid]].filter(
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
                url: process.env.JIRA_URL + "/rest/api/2/issue",
                method: "post",
                headers: headers,
                data: dataToPost
            });

            // return the response to messenger
            const responseText = formatJiraTextForProject(
                postIssueToJira.data,
                projectToPost[0],
                jiraTaskTitle[event.uid]
            );

            sendText(bot, peers[event.uid], responseText);

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
        timeInProgress + " - " + "[" + taskId + "](" + process.env.JIRA_URL + "/browse/" + taskId + ") : " + taskTitle + assignee;
    return outputFormat;
}

function formatJiraTextForProject(task, project, jiraTaskTitle) {
    const outputFormat =
        "[" + task.key + "](" + process.env.JIRA_URL + "/browse/" + task.key + ") : " + jiraTaskTitle;
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

async function sendSortTasks(bot, peer, sortedTasks) {
    let blocks = "";
    let jiraResponse = "";
    const users = Object.keys(sortedTasks);
    users.forEach(function (key, index) {
        jiraResponse += "\n" + key + "\n";
        sortedTasks[key].map(task => {
            jiraResponse += task + "\n";
        });
        if (blocks.length + jiraResponse.length > MESSAGE_LENGTH) {
            sendText(bot, peer, blocks);
            blocks = jiraResponse;
            jiraResponse = "";
        }
        blocks = blocks + jiraResponse;
    });
    await sendText(bot, peer, blocks);
}

async function getCurrentUserNick(bot, peer) {
    const user = await bot.getUser(peer.id);
    return user.nick;
}

async function getCurrentUserLang(bot, uid) {
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
    array.map(object => {
        if (object.task === value) {
            valuePresent = true;
        }
    });
    return valuePresent;
}

function issueStatus(key, uid) {
    let status = "";
    tasksToTrack[uid].map(taskTracked => {
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
            arr.splice(1);
            return arr;
        }
    }
}

function getProjectKey(project) {
    return project.key
}

async function sendText(bot, peer, text, attach, actions) {
    bot.sendText(peer, text, attach, actions).catch(err => console.log(err));
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
        updateJiraTasks().then(_ => setTimeout(updateJiraTasks, TIMEOUT))
    }

    async function updateJiraTasks() {
        for (let key in tasksToTrack) {
            if (tasksToTrack[key] !== undefined) {
                for (let i = 0; i < tasksToTrack[key].length; i++) {
                    let result = await axios({
                        url: process.env.JIRA_URL + "/rest/api/2/issue/" + tasksToTrack[key][i]["task"],
                        method: "get",
                        headers: headers
                    }).then(response => {
                        let data = response.data;
                        if (data.fields.status.name !== issueStatus(data.key, key)) {
                            tasksToTrack[key].map(task => {
                                if (task.task === data.key) {
                                    task.status = data.fields.status.name;
                                    sendText(bot, peers[key], formatJiraTextForChange(data));
                                }
                            });
                        }
                    }).catch(err => console.log(err));
                }
            }
        }
    }