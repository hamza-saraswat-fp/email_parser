Drop real example emails here as `.eml` files (Gmail: open the message, "Show original", "Download original").

This folder is gitignored because the emails contain customer data and the repo is public. Suggested names: `servicechannel.eml`, `heb.eml`, `corrigo.eml`.

Run one through the pipeline without AgentMail or a database:

    npm run replay -- fixtures/emails/servicechannel.eml
