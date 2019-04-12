const dotenv = require("dotenv");
const Bot = require("@dlghq/dialog-bot-sdk");
const {
  MessageAttachment,
  ActionGroup,
  Action,
  Button,
  Select,
  SelectOption
} = require("@dlghq/dialog-bot-sdk");
const { flatMap } = require("rxjs/operators");
const axios = require("axios");
const { merge } = require("rxjs");
const moment = require("moment");
const fs = require("fs");
const request = require("request");
var util = require("util");
var fetch = require("isomorphic-fetch");

dotenv.config();

const credentials =
  process.env.JIRA_USERNAME + ":" + process.env.JIRA_API_TOKEN;
const credsBase64 = Buffer.from(credentials).toString("base64");
var fetchedProjects = [];
var addedIssueKey = "";
var jiraTaskTitle = "";
var messageToReturn = {
  peer: "",
  id: "",
  text: ""
};
const headers = {
  Authorization: "Basic " + credsBase64,
  "Content-Type": "application/json"
};

async function run(token, endpoint) {
  const bot = new Bot.default({
    token,
    endpoints: [endpoint]
  });

  //fetching bot name
  const self = await bot.getSelf();
  console.log(`I've started, post me something @${self.nick}`);

  bot.updateSubject.subscribe({
    next(update) {
       console.log(JSON.stringify({ update }, null, 2));
    }
  });

  //subscribing to incoming messages
  const messagesHandle = bot.subscribeToMessages().pipe(
    flatMap(async message => {
      messageToReturn.peer = message.peer;
      messageToReturn.id = message.id;
      if (message.content.type === "text" && message.attachment === null) {
        jiraTaskTitle = await message.content.text;

        const projects = await axios({
          url: process.env.JIRA_URL,
          method: "get",
          headers: headers
        });

        projects.data.values.map(project => {
          fetchedProjects.push(project);
        });

        //creating dropdown of available project options
        const dropdownActions = [];
        dropdownActions.push();
        fetchedProjects.map(project => {
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
              }),
              Action.create({
                id: "stop",
                widget: Button.create({ label: "stop" })
              })
            ]
          })
        );
      } else if (message.attachment.type === "reply") {
        if (message.content.type === "text") {
          const commentUrl =
            process.env.JIRA_ISSUE_CREATE + "/" + addedIssueKey + "/comment";
          var bodyData = {
            body: message.content.text
          };
          const postIssueToJira = await axios({
            url: commentUrl,
            method: "post",
            headers: headers,
            data: bodyData
          });

          //sending response to the bot
          const response = {
            id: message.id,
            text: "Comment has been added succesfully to the task",
            peer: message.peer
          };
          sendTextToBot(bot, response);
        } else if (message.content.type === "document") {
          const attachmentUrl =
            process.env.JIRA_ISSUE_CREATE_ATTACHMENT +
            "/" +
            addedIssueKey +
            "/attachments";

          const fileUrl = process.env.FILE_UPLOAD_PATH + message.content.name;
          const options = {
            method: "POST",
            url: attachmentUrl,
            headers: {
              Authorization: "Basic " + credsBase64,
              "cache-control": "no-cache,no-cache",
              "X-Atlassian-Token": "no-check",
              "content-type":
                "multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxkTrZu0gW"
            },
            formData: {
              file: {
                value: fs.createReadStream(fileUrl),
                options: { filename: fileUrl, contentType: null }
              }
            }
          };

          //http request to post the image or file as an attachment
          const postIssueToJira = await request(options, function(
            error,
            response,
            body
          ) {
            if (error) throw new Error(error);
            console.log(body);
          });

          const response = {
            id: message.id,
            text: "File has been added succesfully to the task",
            peer: message.peer
          };
          sendTextToBot(bot, response);
        }
      }
    })
  );

  //creating action handle
  const actionsHandle = bot.subscribeToActions().pipe(
    flatMap(async event => {
      if (event.id !== "stop") {
        
        const projectToPost = await fetchedProjects.filter(
          project => project.name === event.value
        );

        const dataToPost = {
          fields: {
            project: {
              key: projectToPost[0].key
            },
            summary: jiraTaskTitle,
            description:
              "Creating of an issue using project keys and issue type names using the REST API",
            issuetype: {
              name: "Task"
            }
          }
        };

        //creating the issue in JIRA
        const postIssueToJira = await axios({
          url: process.env.JIRA_ISSUE_CREATE,
          method: "post",
          headers: headers,
          data: dataToPost
        });

        // return the response to messenger
        const responseText = formatJiraText(
          postIssueToJira.data,
          projectToPost[0],
          jiraTaskTitle
        );
        messageToReturn.text = responseText;
        const mid = await sendTextToBot(bot, messageToReturn);
        //set the returned issue to addedIssueKey
        addedIssueKey = postIssueToJira.data.id;
      } else {
        //code for when stop button is clicked
        messageToReturn.text = "Task addition cancelled by user";
        const mid = await sendTextToBot(bot, messageToReturn);
        fetchedProjects = [];
        messageToReturn = {
          id: "",
          peer: "",
          text: ""
        };
        jiraTaskTitle = "";
      }

      //resetting the variables
      fetchedProjects = [];
      messageToReturn = {
        id: "",
        peer: "",
        text: ""
      };
      jiraTaskTitle = "";
    })
  );

  // merging actionHandle with messageHandle
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
const endpoint =
  process.env.BOT_ENDPOINT || "https://grpc-test.transmit.im:9443";

run(token, endpoint)
  .then(response => console.log(response))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

function formatJiraText(task, project, jiraTaskTitle) {
  const outputFormat =
    "[" + task.key + "](" + task.self + ") :" + jiraTaskTitle;
  return outputFormat;
}

function sendTextToBot(bot, message) {
  bot.sendText(message.peer, message.text, MessageAttachment.reply(message.id));
}
