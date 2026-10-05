/* DVATONE runtime settings. Edit this file on the server, no rebuild needed.
   formEndpoint: address that receives the forms (JSON POST). Examples:
     '/send.php'                              the PHP handler from deploy/php/ (same domain)
     'https://your-function.example/api/lead' the Telegram function from deploy/serverless/
   Leave empty and the forms show a polite "could not send" message instead of a fake success.
   A single form can override this with data-endpoint="..." on the <form>. */
window.DV_CONFIG = {
  formEndpoint: ''
};
