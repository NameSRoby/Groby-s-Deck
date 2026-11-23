/** Practical, editable drafts. Personal links and schedules are explicit placeholders. */
module.exports = ({ chat, timer, event }) => {
  const command = (id, name, group, description, message, role = "viewer", cooldown = 15) => ({
    id,
    name,
    group,
    description,
    trigger: { type: "command", command: "!" + id },
    steps: [chat(message)],
    role,
    cooldownSeconds: 5,
    userCooldownSeconds: cooldown,
  });
  const announcement = (message, color = "primary") => ({
    actionId: "twitch.action.announcement",
    params: { message, color },
    delayMs: 0,
  });
  const threshold = (field, minimum, step) => ({
    type: "if",
    condition: {
      actionId: "twitch.event." + field,
      field: "value",
      operator: "greater",
      value: minimum - 1,
    },
    then: [step],
    else: [],
  });
  const links = [
    [
      "discord",
      "Discord invite",
      40,
      "Join our community Discord: REPLACE_WITH_DISCORD_INVITE",
      "Replace REPLACE_WITH_DISCORD_INVITE with your own invite.",
    ],
    [
      "socials",
      "Social links",
      50,
      "Keep up with the stream: REPLACE_WITH_SOCIAL_LINKS",
      "Replace REPLACE_WITH_SOCIAL_LINKS with your public social links.",
    ],
    [
      "schedule",
      "Stream schedule",
      60,
      "Our usual stream schedule: REPLACE_WITH_DAYS_TIMES_AND_TIMEZONE",
      "Replace REPLACE_WITH_DAYS_TIMES_AND_TIMEZONE with your schedule, including its time zone.",
    ],
  ];
  return [
    ...links.flatMap(([id, name, minutes, message, edit]) => [
      command(
        id,
        name + " (edit details)",
        "Community information",
        edit + " Everyone can request this information.",
        message,
        "viewer",
        60,
      ),
      {
        ...timer(id + "-reminder", name + " reminder (edit details)", minutes, message, 10),
        group: "Community information",
        description:
          edit +
          " Live-only, every " +
          minutes +
          " minutes and at least 10 new chat messages. Use alongside, or instead of, its chat command.",
      },
    ]),
    command(
      "rules",
      "Community rules",
      "Moderation responses",
      "Public reminder of your community rules. Edit these rules to match your channel; this sends text and does not change Twitch moderation settings.",
      "Be kind, respect everyone, avoid harassment and spam, and follow the channel rules. Thank you for keeping chat welcoming!",
      "viewer",
      60,
    ),
    command(
      "spoilers",
      "No spoilers reminder",
      "Moderation responses",
      "Moderators can post a calm spoiler reminder without interrupting the stream. Sends a message only.",
      "Please keep story spoilers and hints out of chat unless the streamer asks. Let everyone enjoy the discovery!",
      "moderator",
      30,
    ),
    command(
      "backseat",
      "Backseating reminder",
      "Moderation responses",
      "Moderator-only reminder. Edit the policy to reflect whether advice is welcome; no timeout or ban is issued.",
      "Please ask before giving gameplay advice. We will let chat know when help is wanted. Thanks!",
      "moderator",
      30,
    ),
    command(
      "links",
      "Ask before posting links",
      "Moderation responses",
      "Moderator-only message explaining your link policy. This does not enable or disable Twitch link filtering.",
      "Please ask a moderator before posting links. Tell us what you would like to share first.",
      "moderator",
      30,
    ),
    {
      ...command(
        "brb",
        "Announce a short break",
        "Stream operations",
        "Moderator-only highlighted break notice. Needs Chat announcements access; this does not change scenes or mute audio.",
        "",
      ),
      steps: [
        announcement(
          "Taking a short break. Get some water, stretch, and we will be right back!",
          "orange",
        ),
      ],
      role: "moderator",
    },
    {
      ...command(
        "back",
        "Announce return from break",
        "Stream operations",
        "Moderator-only highlighted return notice. Needs Chat announcements access.",
        "",
      ),
      steps: [announcement("We are back! Thanks for waiting, and welcome back everyone.", "green")],
      role: "moderator",
    },
    command(
      "win",
      "Add a stream win",
      "Stream counters",
      "Moderator only. Adds one to the persistent streamwins counter. These totals survive restarts; reset explicitly with !resetrecord confirm.",
      "Wins: ${countstreamwins} | Losses: ${readcountstreamlosses}",
      "moderator",
    ),
    command(
      "loss",
      "Add a stream loss",
      "Stream counters",
      "Moderator only. Adds one to the persistent streamlosses counter. These are channel totals, separate from viewer duel statistics.",
      "Wins: ${readcountstreamwins} | Losses: ${countstreamlosses}",
      "moderator",
    ),
    command(
      "record",
      "Read stream win/loss record",
      "Stream counters",
      "Everyone can read the same stream counters without changing them. Install Add a stream win/loss to update these totals.",
      "Wins: ${readcountstreamwins} | Losses: ${readcountstreamlosses}",
    ),
    command(
      "resetrecord",
      "Reset stream win/loss record",
      "Stream counters",
      "Broadcaster only. !resetrecord confirm resets only streamwins and streamlosses. Other counters and viewer records remain unchanged.",
      '${if same ${1} "confirm"}Record reset. Wins: ${resetcountstreamwins} | Losses: ${resetcountstreamlosses}${else}Type !resetrecord confirm to reset the stream win/loss record.${end}',
      "broadcaster",
    ),
    command(
      "goal",
      "Read a named goal",
      "Goals",
      "!goal name shows that goal's progress. Does not create or reset goals. Use the named goal controls or a goal setup preset first.",
      '${if same ${1} ""}Usage: !goal name${else}${goal ${1}}${end}',
    ),
    command(
      "time",
      "Current UTC time",
      "Community information",
      "Shows the current UTC date and time, explicitly labelled so viewers can compare time zones.",
      "Current date and time: ${date} ${time}",
    ),
    timer(
      "clip-reminder",
      "Clip memorable moments reminder",
      55,
      "See a moment worth keeping? Use Twitch's Clip button to save and share it!",
      10,
    ),
    timer(
      "accessibility-reminder",
      "Captions and accessibility reminder",
      75,
      "Need captions or another accessibility adjustment? Let us know what would help and we will do our best.",
      5,
    ),
    timer(
      "community-question",
      "Conversation starter rotation",
      35,
      '${random.pick "What game, show or hobby are you enjoying lately?" "What was a highlight of your week?" "What snack would you bring to community game night?"}',
      15,
    ),
    {
      ...timer(
        "goal-progress-reminder",
        "Named goal progress reminder",
        35,
        "Community goal: ${goal community}",
        10,
      ),
      group: "Goals",
      description:
        "Live-only, every 35 minutes after 10 new chat messages. Change community to your goal's name, or create it with !addgoal community bits 10000 first. Reads progress without resetting it.",
    },
    event(
      "stream-live-welcome",
      "Going live welcome",
      "stream.online",
      "One welcome per stream.online event. Twitch can deliver this before all stream metadata is ready, so the message does not depend on title or category lookups.",
      [chat("We are live! Welcome in, make yourselves comfortable, and enjoy the stream: ${link}")],
      "Stream operations",
    ),
    event(
      "stream-offline-thanks",
      "End of stream thank-you",
      "stream.offline",
      "Posts a closing message when Twitch reports that the stream went offline. Set your own schedule or community link in the text.",
      [chat("Thanks for spending time with us today! Take care, and see you next stream.")],
      "Stream operations",
    ),
    event(
      "ad-break-notice",
      "Ad break notice",
      "channel.ad_break.begin",
      "Announce an ad break after Twitch confirms it started. Requires Ad controls event access. This does not schedule or start an ad.",
      [chat("An ad break has started. Thanks for your patience and for supporting the stream!")],
      "Stream operations",
    ),
    event(
      "poll-open-notice",
      "Poll voting opens",
      "channel.poll.begin",
      "Tell chat when Twitch opens a poll. Requires Poll events access; does not create a poll.",
      [chat("A channel poll is open! Use the poll panel to vote for your choice.")],
      "Polls & predictions",
    ),
    event(
      "poll-closed-notice",
      "Poll voting closes",
      "channel.poll.end",
      "Acknowledge the end of voting. Check Twitch's poll result for the outcome; cancelled polls do not announce a winner.",
      [chat("The poll has ended. Thank you for voting! Check the poll panel for its result.")],
      "Polls & predictions",
    ),
    event(
      "prediction-open-notice",
      "Prediction opens",
      "channel.prediction.begin",
      "Tell chat when Twitch opens a prediction. Requires Prediction widgets & events access; does not create a prediction.",
      [
        chat(
          "A prediction is open! Choose your outcome in the prediction panel before entries close.",
        ),
      ],
      "Polls & predictions",
    ),
    event(
      "prediction-locked-notice",
      "Prediction entries lock",
      "channel.prediction.lock",
      "Explain that entries have closed without claiming that the prediction has been settled.",
      [
        chat(
          "Prediction entries are now locked. Good luck, everyone! We are waiting for the outcome.",
        ),
      ],
      "Polls & predictions",
    ),
    event(
      "prediction-end-notice",
      "Prediction ends",
      "channel.prediction.end",
      "Works for both settled and cancelled predictions without inventing a winning outcome or payout.",
      [
        chat(
          "The prediction has ended. Check the prediction panel for its result and any points returned or awarded.",
        ),
      ],
      "Polls & predictions",
    ),
    event(
      "hype-start-notice",
      "Hype Train starts",
      "channel.hype_train.begin",
      "Acknowledge the start of a real Twitch Hype Train. Requires Hype Train events access.",
      [chat("A Hype Train has started! Thank you for the support. Enjoy the ride, everyone!")],
      "Audience events",
    ),
    event(
      "hype-end-thanks",
      "Hype Train thank-you",
      "channel.hype_train.end",
      "Thank the community once the Hype Train ends, without posting repeated progress messages.",
      [chat("Thank you to everyone who joined the Hype Train! We appreciate you being here.")],
      "Audience events",
    ),
    event(
      "bits-milestone",
      "Large cheer: 1,000+ Bits",
      "channel.cheer",
      "Alternative to the regular Bits thank-you. Only posts for cheers of at least 1,000 Bits; edit the If threshold. Anonymous cheers work too.",
      [
        threshold(
          "bits",
          1000,
          chat("An incredible ${bits} Bits! Thank you for your generosity and support."),
        ),
      ],
    ),
    event(
      "gift-milestone",
      "Gift bundle: 5+ subscriptions",
      "channel.subscription.gift",
      "Alternative to the regular gift thank-you. Only posts for bundles of at least five gifts; edit the If threshold. Does not reveal anonymous gifters.",
      [
        threshold(
          "gifts",
          5,
          chat("${gifts} gifted subscriptions! Thank you for sharing the love with the community."),
        ),
      ],
    ),
    event(
      "charity-start-notice",
      "Charity campaign starts",
      "channel.charity_campaign.start",
      "React to a Twitch-hosted charity campaign starting. Requires Charity goals & donations access. Add your campaign link before enabling.",
      [
        chat(
          "Our Twitch charity campaign is now live! Open the channel's charity panel to learn about the cause and how to contribute.",
        ),
      ],
      "Charity & creator goals",
    ),
    event(
      "charity-donation-thanks",
      "Charity donation thank-you",
      "channel.charity_campaign.donate",
      "Thank a Twitch charity donation without exposing a donor's identity or inventing a currency amount. External tip services require their own integration.",
      [chat("Thank you for donating to our charity campaign and helping make a difference!")],
      "Charity & creator goals",
    ),
    event(
      "charity-end-thanks",
      "Charity campaign closes",
      "channel.charity_campaign.stop",
      "A closing thank-you when Twitch reports the campaign stopped. Does not assume the target was reached.",
      [
        chat(
          "Our charity campaign has closed. Thank you to everyone who donated, shared the cause, or cheered us on!",
        ),
      ],
      "Charity & creator goals",
    ),
    event(
      "creator-goal-start",
      "Twitch creator goal starts",
      "channel.goal.begin",
      "React to a goal created on Twitch. Requires Twitch creator goals access. Named local goals are managed separately with !addgoal.",
      [chat("A new channel goal is underway! Check the Twitch goal panel to see our target.")],
      "Charity & creator goals",
    ),
    event(
      "creator-goal-end",
      "Twitch creator goal ends",
      "channel.goal.end",
      "Acknowledge an ended Twitch goal. The event can represent success or cancellation, so this does not claim the goal was achieved.",
      [
        chat(
          "Our Twitch channel goal has ended. Thank you for your support! Check the goal panel for the final result.",
        ),
      ],
      "Charity & creator goals",
    ),
  ];
};
