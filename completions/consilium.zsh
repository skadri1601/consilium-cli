#compdef consilium

_consilium() {
  local context state line
  typeset -A opt_args

  local -a subcommands
  subcommands=(
    'debate:Start a multi-agent debate on a topic'
    'ask:Ask a question (alias for debate)'
    'chat:Start interactive chat with multi-agent debates'
    'sessions:Manage saved chat sessions'
    'config:Manage CLI configuration'
    'login:Sign in and get a CLI token'
    'logout:Sign out and clear stored credentials'
    'setup-token:Generate a long-lived CI token'
    'share:Share a saved session'
    'voice:Record audio, transcribe via Whisper'
    'agents:Manage background agents'
    'scheduler:Schedule recurring debates'
    'models:Show default models and catalog'
    'mcp:Manage MCP servers and integrations'
    'benchmark:Run deliberation benchmarks'
    'eval:Run blind evaluation of responses'
    'logs:Query logs for a debate'
    'stats:Show model performance dashboard'
    'redteam:Run adversarial red team assessment'
    'debug:Show full debug trace for a debate'
    'upgrade:Update Consilium CLI to the latest version'
    'completions:Print shell completion script'
    'debates:List and manage debate sessions'
    'debate-pr:Fetch and debate a GitHub PR'
    'debate-issue:Fetch and debate a GitHub or Linear issue'
    'debate-failing:Debate the failing tests in the current repo'
    'debate-staged:Debate currently staged changes'
    'help:Show help for a command'
  )

  local -a modes
  modes=(quick council deep blind redteam jury market auto)

  _arguments -C \
    '1: :->command' \
    '*::arg:->args'

  case $state in
    command)
      _describe -t commands 'consilium command' subcommands
      ;;
    args)
      case $words[1] in
        debate|ask)
          _arguments \
            '(-m --models)'{-m,--models}'[Models to use]:models:' \
            '--mode[Debate mode]:mode:(quick council deep blind redteam jury market auto)' \
            '--output[Output format]:format:(markdown cursorrules claude-md json)' \
            '--output-format[Output format]:format:(text json stream-json)' \
            '--json-schema[JSON Schema file]:file:_files' \
            '--max-budget-usd[Abort if cost estimate exceeds USD]:usd:' \
            '--max-turns[Cap the debate at N rounds]:n:' \
            '--file[Files to attach as context]:file:_files' \
            '--ticket[Linear ticket ID]:ticket:' \
            '--plan[Plan mode]' \
            '--apply[Apply structured edits]' \
            '(-b --bg)'{-b,--bg}'[Run as a detached background agent]' \
            '--generate-image[Generate an image from synthesis]' \
            '--image-prompt-from[Source of image prompt]:src:(synthesis topic)' \
            '--image-size[Image size]:size:' \
            '--no-git[Do not auto-attach git diff]' \
            '--no-tools[Do not expose tools to council]' \
            '--no-context[Disable automatic codebase context]'
          ;;
        completions)
          _arguments '1:shell:(bash zsh fish)'
          ;;
        sessions)
          _arguments '1:subcommand:(list resume rename delete)'
          ;;
        config)
          _arguments '1:subcommand:(set get list)'
          ;;
        mcp)
          _arguments '1:subcommand:(setup add list remove test tools)'
          ;;
        debates)
          _arguments '1:subcommand:(list cancel start stream)'
          ;;
        models)
          _arguments \
            '--check[Exit non-zero if any default model is deprecated]' \
            '--json[Emit as JSON]'
          ;;
        setup-token)
          _arguments \
            '(-n --name)'{-n,--name}'[Token label]:name:' \
            '(-d --days)'{-d,--days}'[Token lifetime in days]:days:' \
            '--print[Print only the token]'
          ;;
        voice)
          _arguments \
            '--once[Record one clip and exit]' \
            '(-l --language)'{-l,--language}'[Language code]:lang:' \
            '--debate[Pipe transcript into a debate]' \
            '(-m --mode)'{-m,--mode}'[Debate mode]:mode:(quick council deep blind redteam jury market auto)' \
            '--max-seconds[Maximum recording length]:seconds:'
          ;;
      esac
      ;;
  esac
}

compdef _consilium consilium
