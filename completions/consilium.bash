_consilium_completion() {
  local cur prev words cword
  if declare -F _init_completion >/dev/null 2>&1; then
    _init_completion || return
  else
    COMPREPLY=()
    cur="${COMP_WORDS[COMP_CWORD]}"
    prev="${COMP_WORDS[COMP_CWORD-1]}"
    words=("${COMP_WORDS[@]}")
    cword=$COMP_CWORD
  fi

  local subcommands="debate ask chat sessions config login logout setup-token share voice agents scheduler models mcp benchmark eval logs stats redteam debug upgrade completions debates debate-pr debate-issue debate-failing debate-staged help"
  local debate_flags="--mode --models --plan --output --output-format --json-schema --max-budget-usd --max-turns --worktree --sandbox --bg --generate-image --image-prompt-from --image-size --file --ticket --apply --no-git --no-tools --no-context"
  local modes="quick council deep blind redteam jury market auto"

  case ${COMP_CWORD} in
    1)
      COMPREPLY=( $(compgen -W "${subcommands}" -- ${cur}) )
      return
      ;;
  esac

  case ${words[1]} in
    debate|ask)
      case ${prev} in
        --mode) COMPREPLY=( $(compgen -W "${modes}" -- ${cur}) ); return ;;
        --output-format) COMPREPLY=( $(compgen -W "text json stream-json" -- ${cur}) ); return ;;
        --output) COMPREPLY=( $(compgen -W "markdown cursorrules claude-md json" -- ${cur}) ); return ;;
        --file|--json-schema) COMPREPLY=( $(compgen -f -- ${cur}) ); return ;;
        --image-prompt-from) COMPREPLY=( $(compgen -W "synthesis topic" -- ${cur}) ); return ;;
      esac
      COMPREPLY=( $(compgen -W "${debate_flags}" -- ${cur}) )
      ;;
    completions)
      COMPREPLY=( $(compgen -W "bash zsh fish" -- ${cur}) )
      ;;
    sessions)
      COMPREPLY=( $(compgen -W "list resume rename delete" -- ${cur}) )
      ;;
    config)
      COMPREPLY=( $(compgen -W "set get list" -- ${cur}) )
      ;;
    mcp)
      COMPREPLY=( $(compgen -W "setup add list remove test tools" -- ${cur}) )
      ;;
    debates)
      COMPREPLY=( $(compgen -W "list cancel start stream" -- ${cur}) )
      ;;
    models)
      COMPREPLY=( $(compgen -W "--check --json" -- ${cur}) )
      ;;
    *) COMPREPLY=() ;;
  esac
}
complete -F _consilium_completion consilium
