Update the existing Te Kaupapa AI prototype. Do not rebuild the app from scratch.

The current Pou-by-Pou pathway is conceptually right, but the conversation screen has become too basic and has lost some of the richer experience from the earlier UI. I want to keep the idea that each Safety Pou has its own focused conversation and review, but restore the richer Guided Reflection experience and keep the existing Pou Review screen style.

Important workflow correction:

The kaimahi journey should be:

1. Setup Reflection
2. Safety Pou Journey Overview
3. Full Guided Reflection conversation for Safety Pou 1
4. Review screen for Safety Pou 1
5. Full Guided Reflection conversation for Safety Pou 2
6. Review screen for Safety Pou 2
7. Full Guided Reflection conversation for Safety Pou 3
8. Review screen for Safety Pou 3
9. Continue this pattern through all six Safety Pou
10. Final Safety Pou Summary
11. Risks and Actions
12. Referral Pathways
13. Synthesis
14. Record / Email Record
15. Finish

The six Safety Pou are:

1. Whakapapa, Mana & Whanaungatanga
2. Hinengaro & Whatumanawa
3. Waranga, Tinana & Daily Functioning
4. Wairua, Mauri & Cultural Connection
5. Kāinga, Taiao & Material Stability
6. Mana Motuhake & Ara Tautoko

Key instruction:
Do not make the Pou conversation screen basic. Each Pou conversation should use the same rich Guided Reflection conversation UI from the earlier version of the prototype, but focused on the current Safety Pou.

Restore or strengthen the richer conversation experience:
- strong visual entry into the conversation screen
- warm transition from Safety Pou Journey Overview into the current Pou conversation
- clear current Pou header
- current Pou description
- voice reflection controls
- connection state
- large calm conversation area
- optional text fallback
- clear progress such as “Pou 2 of 6”
- subtle Whare of Safety motif
- sense of entering a focused reflective space
- clear button to end the current Pou conversation
- clear button to review the current Pou

Add lightweight but meaningful transitions and states:
- entering the Pou conversation
- connecting to the reflective guide
- listening
- reflective guide speaking
- ending the Pou conversation
- preparing Pou review
- review ready

The phone remains a thin client. These transitions should be lightweight and realistic:
- no heavy waveforms
- no complex animation
- no large animated backgrounds
- no real-time local AI analysis visuals
- no implication that the phone is doing heavy processing

Instead use:
- gentle fade or slide transitions
- calm loading states
- subtle structural movement based on the Whare of Safety motif
- simple progress indicators
- short status messages such as “Preparing this Pou for review”

Keep the existing Pou Review screen style and improve it if needed.

After each focused Pou conversation, show the Pou Review screen for that same Pou.

The Pou Review screen should include:
- current Safety Pou name
- current Safety Pou description
- what was discussed
- what was not discussed or remains unclear
- protective factors
- risk factors
- concern level
- suggested actions
- referral flag
- supervisor review flag
- edit or confirm controls
- button to continue to the next Safety Pou

Concern levels:
- Low concern
- Watch closely
- Action needed
- Urgent escalation

The Pou Review screen should feel like reviewing one structural support in the Whare of Safety. It should not feel like a compliance checklist.

After the kaimahi confirms the review for one Safety Pou:
- if there is another Safety Pou, transition into the next full Guided Reflection conversation screen
- if all six Safety Pou have been reviewed, transition to the Final Safety Pou Summary screen

Do not insert a separate actions screen after each individual Pou conversation. Keep actions, referrals and synthesis later in the flow as they currently are.

Actions should still be linked to Safety Pou, but the main Risks and Actions screen should come after the Final Safety Pou Summary.

The Final Safety Pou Summary screen should show:
- all six Safety Pou
- completion status for each
- short summary for each
- protective factors identified
- risk factors identified
- any suggested actions
- any referral flags
- any supervisor review flags
- any Pou where more kōrero is needed

Then continue into:
- Risks and Actions
- Referral Pathways
- Synthesis
- Record

Design requirements:
- preserve the Whare of Safety motif
- keep the experience mobile-first for kaimahi
- the supervisor view can remain desktop-first
- preserve NHC colours #74C400 and #1366CC
- preserve the NHC logo
- keep the emotional experience calm, grounded, reflective and supportive
- avoid generic SaaS dashboard styling
- avoid generic chatbot styling
- avoid project management board styling
- avoid dense mobile tables
- avoid making the Pou sequence feel like a rigid checklist

The key design goal:
Each Safety Pou should feel like its own focused reflective room inside the Whare of Safety. The kaimahi enters that Pou conversation, has a rich guided reflection, reviews what was captured for that Pou, then moves gently to the next Pou. The whole journey should feel structured, supportive and manageable, while preserving the richer conversation UI from the earlier design.