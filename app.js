const party = "C05HZC9DKK2"; //"C05HZC9DKK2"; // replace with ST's party channel?
const { App } = require("@slack/bolt");
/*const { App, AwsLambdaReceiver } = require("@slack/bolt");
const awsLambdaReceiver = new AwsLambdaReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});*/
const app = new App({
  //token: process.env.SLACK_BOT_TOKEN,
  //receiver: awsLambdaReceiver,
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,

  port: process.env.PORT || 3000,
});
let pinned_message_ts = {};

app.event("reaction_added", async ({ event, client, logger }) => {
  try {
    if (event.item_user === "U074LJY8AVB") {
      const message_result = await client.conversations.history({
        channel: party,
        latest: event.item.ts,
        inclusive: true,
        limit: 1,
      });

      message_text = message_result.messages[0].text;
      const index = message_text.search("has created the event");
      if (index !== -1) {
        const index_pound = message_text.indexOf("#");
        const index_bracket = message_text.lastIndexOf(">");
        const event_channel = message_text.slice(
          index_pound + 1,
          index_bracket
        );
        const addToChannel = await client.conversations.invite({
          channel: event_channel,
          users: event.user,
        });
        // send link of og message
        const members = await client.conversations.members({
          channel: event_channel,
        });

        if (members.members.length % 5 === 0) {
          const permalink = await client.chat.getPermalink({
            channel: party,
            message_ts: event.item.ts,
          });
          const num_members = members.members.length - 1;
          const reminder = await client.chat.postMessage({
            channel: party,
            text: `${num_members} people are going to this event! React to the original message to join: ${permalink.permalink}`,
          });
        }
      }
    }
  } catch (error) {
    logger.error(error);
    if (error.data.error === "already_in_channel") {
      const error_message = await client.chat.postEphemeral({
        channel: event.item.channel,
        user: event.user,
        text: "You have already joined the event.",
      });
    } else {
      // send ephemeral message if event is archived
      const error_message = await client.chat.postEphemeral({
        channel: event.item.channel,
        user: event.user,
        text: "This event no longer exists.",
      });
    }
  }
});

app.command("/event", async ({ ack, body, client, logger }) => {
  // Acknowledge command request
  await ack();

  try {
    // Call views.open with the built-in client
    const result = await client.views.open({
      // Pass a valid trigger_id within 3 seconds of receiving it
      trigger_id: body.trigger_id,
      // View payload
      view: {
        type: "modal",
        // View identifier
        callback_id: "view_1",
        title: {
          type: "plain_text",
          text: "Event Planner",
        },
        blocks: [
          {
            type: "input",
            block_id: "name",
            label: {
              type: "plain_text",
              text: "What is your channel for the event called?",
              // add hint text that gives description for what to call the channel
            },
            element: {
              type: "plain_text_input",
              action_id: "name_action",
              placeholder: {
                type: "plain_text",
                text: "Event name",
              },
            },
            hint: {
              type: "plain_text",
              text: "Channel names can only contain lowercase letters, numbers, hyphens, and underscores. They must be 80 characters or less.",
            },
          },
          {
            type: "input",
            block_id: "message",
            label: {
              type: "plain_text",
              text: "Message to channel",
            },
            element: {
              type: "plain_text_input",
              action_id: "message_action",
              placeholder: {
                type: "plain_text",
                text: "Write a message to the channel. Ask them to react to join!",
              },
              multiline: true,
            },
          },
          {
            type: "input",
            optional: true,
            block_id: "time",
            element: {
              type: "datetimepicker",
              action_id: "time_action",
            },
            label: {
              type: "plain_text",
              text: "Time",
              emoji: true,
            },
            hint: {
              type: "plain_text",
              text: "Automatic reminders are sent to the event channel and main channel a few days before the event. If you don't have a time yet, you can poll in your events channel with /poll and automatic reminders will not occur.",
            },
          },
          {
            type: "input",
            optional: true,
            block_id: "location",
            label: {
              type: "plain_text",
              text: "Location",
            },
            element: {
              type: "plain_text_input",
              action_id: "location_action",
              placeholder: {
                type: "plain_text",
                text: "Where is your event happening?",
              },
            },
            hint: {
              type: "plain_text",
              text: "If you don't have a location yet, you can poll in your events channel with /poll",
            },
          },
          {
            type: "input",
            optional: true,
            block_id: "details",
            label: {
              type: "plain_text",
              text: "Additional Details",
            },
            element: {
              type: "plain_text_input",
              action_id: "details_action",
              placeholder: {
                type: "plain_text",
                text: "What to bring, what to wear, etc.",
              },
              multiline: true,
            },
            hint: {
              type: "plain_text",
              text: "This will only be posted to the event channel.",
            },
          },
        ],
        submit: {
          type: "plain_text",
          text: "Submit",
        },
      },
    });
  } catch (error) {
    logger.error(error);
  }
});
let scheduled_messages = {};
app.view("view_1", async ({ ack, body, view, client, logger }) => {
  const name = view["state"]["values"]["name"]["name_action"]["value"];

  const message = view["state"]["values"]["message"]["message_action"]["value"];
  const time =
    view["state"]["values"]["time"]["time_action"]["selected_date_time"];
  const location =
    view["state"]["values"]["location"]["location_action"]["value"];
  const details = view["state"]["values"]["details"]["details_action"]["value"];
  const user = body["user"]["id"];

  let display_time = "To be decided in channel";
  let display_location = "To be decided in channel";
  let display_details = "None";

  let channel_result = "";

  const curr_time = Date.now() / 1000;
  if (time && curr_time >= time) {
    let errors = {};
    errors["time"] = "Cannot pick a date that has already passed";
    await ack({
      response_action: "errors",
      errors: errors,
    });
    return;
  }
  try {
    channel_result = await client.conversations.create({
      name: name,
    });
    await ack();
  } catch (error) {
    let errors = {};

    if (error.data.error === "invalid_name_specials") {
      errors["name"] =
        "Channel names can only contain lowercase letters, numbers, hyphens, and underscores. They must be 80 characters or less.";
    } else if (error.data.error === "name_taken") {
      errors["name"] = "Channel name already exists.";
    } else {
      errors["name"] = "Try a different channel name.";
    }
    await ack({
      response_action: "errors",
      errors: errors,
    });
    channel_result = await client.conversations.create({
      name: name,
    });
  }
  if (time) {
    display_time =
      new Date(time * 1000).toDateString() +
      ", " +
      new Date(time * 1000).toLocaleTimeString("en-US");
  }
  if (location) {
    display_location = location;
  }
  if (details) {
    display_details = details;
  }
  try {
    const channel_id = channel_result["channel"]["id"];

    // create automatic reminders
    const result = await client.chat.postMessage({
      channel: party,
      text:
        `*<@${user}> has created the event <#${channel_id}>:*\n` +
        `*Time:* ${display_time}\n` +
        `*Location:* ${display_location}\n` +
        `>${message}`,
    });
    scheduled_messages[channel_id] = [];
    if (time) {
      const three_days_unix = 86400 * 3;
      const one_day_unix = 86400;

      if (curr_time <= time - three_days_unix) {
        const permalink = await client.chat.getPermalink({
          channel: party,
          message_ts: result.ts,
        });

        const three_remind_general = await client.chat.scheduleMessage({
          channel: party,
          post_at: time - three_days_unix,
          text: `<#${channel_id}> is set to happen soon! React to the original message to join: ${permalink.permalink}`,
        });
        const three_remind_event = await client.chat.scheduleMessage({
          channel: channel_id,
          post_at: time - three_days_unix,
          text: `Hey <!channel>,  <#${channel_id}> is set to happen soon!`,
        });
        scheduled_messages[channel_id].push(
          three_remind_general.scheduled_message_id,
          three_remind_event.scheduled_message_id
        );
      }
      if (curr_time <= time - one_day_unix) {
        const permalink = await client.chat.getPermalink({
          channel: party,
          message_ts: result.ts,
        });

        const one_remind_general = await client.chat.scheduleMessage({
          channel: party,
          post_at: time - one_day_unix,
          text: `<#${channel_id}> is set to happen soon! React to the original message to join: ${permalink.permalink}`,
        });
        const one_remind_event = await client.chat.scheduleMessage({
          channel: channel_id,
          post_at: time - one_day_unix,
          text: `Hey <!channel>, <#${channel_id}> is set to happen soon!`,
        });
        scheduled_messages[channel_id].push(
          one_remind_general.scheduled_message_id,
          one_remind_event.scheduled_message_id
        );
      }
    }

    const addToChannel = await client.conversations.invite({
      channel: channel_id,
      users: user,
    });
    const new_message = await client.chat.postMessage({
      channel: channel_id,
      text:
        `*Organizer:* <@${user}>\n` +
        `*Time:* ${display_time}\n` +
        `*Location:* ${display_location}\n` +
        `*Additional Details:* ${display_details}`,
    });
    const time_stamp = new_message["ts"];
    const pin_message = await client.pins.add({
      channel: channel_id,
      timestamp: time_stamp,
    });
    pinned_message_ts[channel_id] = time_stamp;
  } catch (error) {
    logger.error(error);
  }
});

app.event("channel_deleted", async ({ event, client, logger }) => {
  try {
    const channel_name = event.channel;

    if (channel_name in scheduled_messages) {
      const arr = scheduled_messages[channel_name];

      if (scheduled_messages[channel_name].length === 4) {
        await client.chat.deleteScheduledMessage({
          channel: party,
          scheduled_message_id: arr[0],
        });
        await client.chat.deleteScheduledMessage({
          channel: party,
          scheduled_message_id: arr[2],
        });
      } else if (scheduled_messages[channel_name].length === 2) {
        const result = await client.chat.deleteScheduledMessage({
          channel: party,
          scheduled_message_id: arr[0],
        });
      } else {
      }
      delete scheduled_messages[channel_name];
    }
    //console.log(await client.chat.scheduledMessages.list({}));
    //console.log(result.schedule_messages);
  } catch (error) {
    logger.error(error);
  }
});

app.event("channel_archive", async ({ event, client, logger }) => {
  try {
    const channel_name = event.channel;

    if (channel_name in scheduled_messages) {
      const arr = scheduled_messages[channel_name];

      if (scheduled_messages[channel_name].length === 4) {
        await client.chat.deleteScheduledMessage({
          channel: party,
          scheduled_message_id: arr[0],
        });
        await client.chat.deleteScheduledMessage({
          channel: party,
          scheduled_message_id: arr[2],
        });
      } else if (scheduled_messages[channel_name].length === 2) {
        const result = await client.chat.deleteScheduledMessage({
          channel: party,
          scheduled_message_id: arr[0],
        });
      } else {
      }
      delete scheduled_messages[channel_name];
    }
  } catch (error) {
    logger.error(error);
  }
});

let recent_channel = "";

app.command("/edit", async ({ ack, body, client, logger }) => {
  // Acknowledge command request
  await ack();
  // find first message created, compare if user id is in that message
  recent_channel = body.channel_id;
  try {
    const message_result = await client.conversations.history({
      channel: body.channel_id,

      latest: pinned_message_ts[body.channel_id],
      inclusive: true,
      limit: 1,
    });
    message_text = message_result.messages[0].text;

    const index = message_text.search("Organizer");
    if (index !== -1) {
      const index_left = message_text.indexOf("<@");
      const index_right = message_text.indexOf(">");
      const event_user = message_text.slice(index_left + 2, index_right);

      if (event_user === body.user_id) {
        let end = "\n";
        let search = "*Time:* ";
        let firstIndex = message_text.indexOf(search) + search.length;
        let lastIndex = message_text.indexOf(end, firstIndex);
        let prev_time = message_text.slice(firstIndex, lastIndex);

        search = "*Location:* ";
        firstIndex = message_text.indexOf(search) + search.length;
        lastIndex = message_text.indexOf(end, firstIndex);
        const prev_location = message_text.slice(firstIndex, lastIndex);
        search = "*Additional Details:* ";
        firstIndex = message_text.indexOf(search) + search.length;
        //lastIndex = message_text.indexOf(end, firstIndex);
        const prev_details = message_text.slice(firstIndex);

        if (prev_time !== "To be decided in channel") {
          prev_time = new Date(prev_time).getTime() / 1000;
        } else {
          prev_time = undefined;
        }
        try {
          // Call views.open with the built-in client
          const result = await client.views.open({
            // Pass a valid trigger_id within 3 seconds of receiving it
            trigger_id: body.trigger_id,
            // View payload
            view: {
              type: "modal",
              // View identifier
              callback_id: "view_2",
              title: {
                type: "plain_text",
                text: "Edit Event",
              },
              blocks: [
                {
                  type: "input",
                  optional: true,
                  block_id: "time",
                  element: {
                    type: "datetimepicker",
                    action_id: "time_action",
                    initial_date_time: prev_time,
                  },
                  label: {
                    type: "plain_text",
                    text: "Time",
                    emoji: true,
                  },
                  hint: {
                    type: "plain_text",
                    text: "Changing the time here will not create new automatic reminders. If you don't have a time yet, you can poll in your events channel with /poll.",
                  },
                },
                {
                  type: "input",
                  optional: true,
                  block_id: "location",
                  label: {
                    type: "plain_text",
                    text: "Location",
                  },
                  element: {
                    type: "plain_text_input",
                    action_id: "location_action",
                    initial_value: prev_location,
                  },
                  hint: {
                    type: "plain_text",
                    text: "If you don't have a location yet, you can poll in your events channel with /poll",
                  },
                },
                {
                  type: "input",
                  optional: true,
                  block_id: "details",
                  label: {
                    type: "plain_text",
                    text: "Additional Details",
                  },
                  element: {
                    type: "plain_text_input",
                    action_id: "details_action",
                    initial_value: prev_details,
                    multiline: true,
                  },
                  hint: {
                    type: "plain_text",
                    text: "This will only be posted to the event channel.",
                  },
                },
              ],
              submit: {
                type: "plain_text",
                text: "Submit",
              },
            },
          });
        } catch (error) {
          logger.error(error);
        }
      } else {
        const error_message = await client.chat.postEphemeral({
          channel: body.channel_id,
          user: body.user_id,
          text: "Only the event organizer can edit the event.",
        });
      }
    } else {
      const error_message = await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: "There is no event in this channel.",
      });
    }
  } catch (error) {
    logger.error(error);
  }
});

app.view("view_2", async ({ ack, body, view, client, logger }) => {
  const time =
    view["state"]["values"]["time"]["time_action"]["selected_date_time"];
  const location =
    view["state"]["values"]["location"]["location_action"]["value"];
  const details = view["state"]["values"]["details"]["details_action"]["value"];
  const user = body["user"]["id"];

  let display_time = "To be decided in channel";
  let display_location = "To be decided in channel";
  let display_details = "None";

  const curr_time = Date.now() / 1000;
  if (time && curr_time >= time) {
    let errors = {};
    errors["time"] = "Cannot pick a date that has already passed";
    await ack({
      response_action: "errors",
      errors: errors,
    });
    return;
  }
  await ack();
  if (time) {
    display_time =
      new Date(time * 1000).toDateString() +
      ", " +
      new Date(time * 1000).toLocaleTimeString("en-US");
  }
  if (location) {
    display_location = location;
  }
  if (details) {
    display_details = details;
  }
  try {
    const new_message = await client.chat.update({
      channel: recent_channel,
      ts: pinned_message_ts[recent_channel],
      text:
        `*Organizer:* <@${user}>\n` +
        `*Time:* ${display_time}\n` +
        `*Location:* ${display_location}\n` +
        `*Additional Details:* ${display_details}`,
    });
    const update_message = await client.chat.postMessage({
      channel: new_message.channel,
      text: `Hey <!channel>, this event has been updated! Check the pinned message for more details!`,
    });
  } catch (error) {
    logger.error(error);
  }
});

app.command("/report", async ({ ack, body, client, logger }) => {
  await ack();
  const left_index = body.text.indexOf("#");
  const right_index = body.text.indexOf("|");
  const reported_channel = body.text.slice(left_index + 1, right_index);
  // read in parameters
  // type the name of channel starting with #
  try {
    const message_result = await client.conversations.history({
      channel: reported_channel,
      latest: pinned_message_ts[reported_channel],
      inclusive: true,
      limit: 1,
    });
    message_text = message_result.messages[0].text;

    const index = message_text.search("Organizer");
    if (index !== -1) {
      const index_left = message_text.indexOf("<@");
      const index_right = message_text.indexOf(">");
      const event_user = message_text.slice(index_left + 2, index_right);

      const error_message = await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: `Thank you for your anonymous report. We have asked the organizer to reconsider their event.`,
      });
      const dm_message = await client.chat.postMessage({
        channel: event_user,
        text: `Hello, this is a check in on your upcoming event <#${reported_channel}>. Please check that it follows community norms, and that it does no harm to your fellow members or others outside of your community! `,
      });
    } else {
      const error_message = await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: "This event does not exists.",
      });
    }
  } catch (error) {
    logger.error(error);
    const error_message = await client.chat.postEphemeral({
      channel: body.channel_id,
      user: body.user_id,
      text: "This event does not exists.",
    });
  }
});
(async () => {
  // Start your app
  await app.start();

  console.log("⚡️ Bolt app is running!");
})();
/*module.exports.handler = async (event, context, callback) => {
  const handler = await awsLambdaReceiver.start();
  return handler(event, context, callback);
};*/
