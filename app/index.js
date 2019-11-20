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

dotenv.config();

const credentials =
  process.env.JIRA_USERNAME + ":" + process.env.JIRA_PASSWORD;
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


async function run(token, endpoint) {
  const bot = new Bot.default({
    token,
    endpoints: [endpoint]
  });

  //fetching bot name
  const self = await bot.getSelf();
  console.log(credentials);
  console.log(credsBase64);
  console.log(`I've started, post me something @${self.nick}`);

  bot.updateSubject.subscribe({
    next(update) {
      console.log(JSON.stringify({ update }, null, 2));
    }
  });

  setInterval(async function() {
      for (let key in tasksToTrack){
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
                        bot.sendText(peers[key], formatJiraTextForChange(data), null);
                      }
                    });
                  }
                }).catch(err => console.log(err));
            }
        }
      }
    }, TIMEOUT);

  //subscribing to incoming messages
  const messagesHandle = bot.subscribeToMessages().pipe(
    flatMap(async message => {
      console.log("MESSAGE", message);
      peers[message.peer.id] = message.peer;

      if (message.content.type === "text") {
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
              }).then(res=>
                {
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
                return bot.sendText(message.peer,
                    "Unknown project code. Valid project codes: `" + projectsArray.map(getProjectKey).join("`, `")+ "`",
                    null)
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
                  sortedTasks[creator.toString()].push(formatJiraText(issue));
                });
                bot.sendText(message.peer, sortTasks(sortedTasks), null);
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
                        let inprogressIssues = response.data.issues.map(formatJiraText).join("\n");
                        console.log(response.data.issues.length > 0);
                        if (response.data.issues.length > 0) {
                            bot.sendText(message.peer, inprogressIssues, null);
                        } else {
                            bot.sendText(message.peer, "You has no tasks in status \"In Progress\"", null);
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
              }).then(res=>
                {
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
              const mid = await bot.sendText(
                message.peer,
                "Select the project you want to add the task",
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
              if (comment !== ""){
                  const bodyData = {
                    body: comment
                  };
                  const postIssueToJira = await axios({
                    url: commentUrl,
                    method: "post",
                    headers: headers,
                    data: bodyData
                  });

                  bot.sendText(message.peer, "Comment has been added succesfully to the task", null);
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
                  if (containsValue(tasksToTrack[message.peer.id], commandsArray[1])){
                      bot.sendText(message.peer, "I'm already tracking " + commandsArray[1] + " for you <3", null);
                  } else {
                     tasksToTrack[message.peer.id].push(issue);
                     bot.sendText(message.peer, "I'm tracking " + commandsArray[1] + " for you <3", null);
                  }
                })
                .catch(err => {
                  bot.sendText(message.peer, "No task " + commandsArray[1], null);
                  console.log(err);
                });
            } else if (commandsArray[0] === REMIND_STOP_COMMAND && commandsArray.length === 2) {
              if (tasksToTrack[message.peer.id] === undefined) tasksToTrack[message.peer.id] = [];
              console.log("logs", containsValue(tasksToTrack[message.peer.id], commandsArray[1]));
              if (containsValue(tasksToTrack[message.peer.id], commandsArray[1])) {
                tasksToTrack[message.peer.id] = removeValue(tasksToTrack[message.peer.id], commandsArray[1]);
                console.log("remaining", tasksToTrack[message.peer.id]);
                bot.sendText(message.peer, "I'm stop tracking " + commandsArray[1] + " for you <3", null);
              } else {
                bot.sendText(message.peer, "I'm not tracking " + commandsArray[1] + " for you <3");
              }
            } else {
              const msg = "send commands:\n" +
                  "`" + USERS_ACTIVE_COMMAND + " project_code` - for get all tasks in `project_code` project with status " +
                  "\"In Progress\" (example `project_code` = `DP` Dialog Platform),\n" +
                  "`" + USER_COMMAND + "` - for get your tasks with status \"In Progress\",\n" +
                  "`" + REMIND_COMMAND + " task_id` - for start tracking change status for `task_id`,\n" +
                  "`" + REMIND_STOP_COMMAND + " task_id` - for stop tracking change status for `task_id`,\n" +
                  "`" + COMMENT_COMMAND + " task_id`\n" +
                  "`comment_text` - for add comment to `task_id` with `comment_text`,\n" +
                  "`" + NEW_TASK_COMMAND + "`\n" +
                  "`title_text`\n" +
                  "`description_text` - for create new task with title = `title_text` and description = `description_text`";
              bot.sendText(message.peer, msg, null);
          }
      }
    })
  );

  const actionsHandle = bot.subscribeToActions().pipe(
    flatMap(async event => {
        const projectToPost = await fetchedProjects[[event.uid]].filter(
        project => project.name === event.value
        );

        let description = jiraTaskDescription[event.uid] ||
            "Creating of an issue using project keys and issue type names using the REST API";

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

        bot.sendText(peers[event.uid], responseText, null);

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

//token to connect to the bot
const token = process.env.BOT_TOKEN;
if (typeof token !== "string") {
  throw new Error("BOT_TOKEN env variable not configured");
}

//bot endpoint
const endpoint = process.env.BOT_ENDPOINT;

run(token, endpoint).catch(error => {
  console.error(error);
  process.exit(1);
});

function formatJiraText(issue) {
  const timeInProgress = moment(issue.fields.updated).fromNow();
  const taskId = issue.key;
  const taskTitle = issue.fields.summary;
  let assignee = "";
  if (issue.fields.assignee !== null) {
      assignee = " (assignee " + issue.fields.assignee.displayName.toString() + ")";
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

function sortTasks(sortedTasks) {
  let jiraResponse = "";
  const users = Object.keys(sortedTasks);
  users.forEach(function(key, index) {
    jiraResponse += "\n" + key + "\n";
    sortedTasks[key].map(task => {
      jiraResponse += task + "\n";
    });
  });

  return jiraResponse;
}

async function getCurrentUserNick(bot, peer) {
  const user = await bot.getUser(peer.id);
  return user.nick;
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