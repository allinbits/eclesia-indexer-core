import chalk from "chalk";
import readline from "readline";

function lpad (str: string | number, padString: string, length: number) {
  while (str.toString().length < length) {
    str = padString + "" + str;
  }

  return str;
}

export class Logger {
  public log_level: number = 0;

  constructor (log_level = 0) {
    this.log_level = log_level;
  }

  setLogLevel (l: number) {
    this.log_level = l;
  }

  /*
	Logging Levels
	0: Minimum - Explicit logging & Errors
	1: Info - 0 + Basic logging
	2: Verbose - 1 + Verbose logging
	3: Transient - 2 + Transient messages
	*/
  timestamp () {
    const date = new Date();
    let month = "" + (date.getMonth() + 1);
    let day = "" + date.getDate();
    const year = date.getFullYear();

    if (month.length < 2) month = "0" + month;
    if (day.length < 2) day = "0" + day;
    let offset;
    if (date.getTimezoneOffset() < 0) {
      offset = "+" + (0 - date.getTimezoneOffset()) / 60;
    } else {
      if (date.getTimezoneOffset() > 0) {
        offset = "+" + date.getTimezoneOffset() / 60;
      } else {
        offset = "";
      }
    }

    return (
      [year, month, day].join("-") +
      " " +
      lpad(date.getHours(), "0", 2) +
      ":" +
      lpad(date.getMinutes(), "0", 2) +
      ":" +
      lpad(date.getSeconds(), "0", 2) +
      "." +
      lpad(date.getMilliseconds(), "0", 3) +
      " GMT" +
      offset
    );
  }

  log (msg: string) {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(
      chalk.white(this.timestamp()) +
        " - " +
        chalk.magenta("[LOG]") +
        " " +
        msg +
        "\n"
    );
  }

  info (msg: string) {
    if (this.log_level > 0) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(
        chalk.white(this.timestamp()) +
          " - " +
          chalk.cyan("[INFO]") +
          " " +
          msg +
          "\n"
      );
    }
  }

  warning (msg: string) {
    if (this.log_level > 0) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(
        chalk.white(this.timestamp()) +
          " - " +
          chalk.yellow("[WARNING]") +
          " " +
          msg +
          "\n"
      );
    }
  }

  error (msg: string) {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(
      chalk.white(this.timestamp()) +
        " - " +
        chalk.red("[ERROR]") +
        " " +
        msg +
        "\n"
    );
  }

  verbose (msg: string) {
    if (this.log_level > 1) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(
        chalk.white(this.timestamp()) +
          " - " +
          chalk.blue("[VERBOSE]") +
          " " +
          msg +
          "\n"
      );
    }
  }

  transient (msg: string) {
    if (this.log_level > 2) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(chalk.white(msg));
    }
  }
}
