function __consilium_no_subcommand
    set -l cmd (commandline -opc)
    if test (count $cmd) -eq 1
        return 0
    end
    return 1
end

function __consilium_using_subcommand
    set -l cmd (commandline -opc)
    if test (count $cmd) -ge 2
        if test "$cmd[2]" = "$argv[1]"
            return 0
        end
    end
    return 1
end

complete -c consilium -f

complete -c consilium -n '__consilium_no_subcommand' -a debate -d 'Start a multi-agent debate on a topic'
complete -c consilium -n '__consilium_no_subcommand' -a ask -d 'Ask a question (alias for debate)'
complete -c consilium -n '__consilium_no_subcommand' -a chat -d 'Start interactive chat with multi-agent debates'
complete -c consilium -n '__consilium_no_subcommand' -a sessions -d 'Manage saved chat sessions'
complete -c consilium -n '__consilium_no_subcommand' -a config -d 'Manage CLI configuration'
complete -c consilium -n '__consilium_no_subcommand' -a login -d 'Sign in and get a CLI token'
complete -c consilium -n '__consilium_no_subcommand' -a logout -d 'Sign out and clear stored credentials'
complete -c consilium -n '__consilium_no_subcommand' -a setup-token -d 'Generate a long-lived CI token'
complete -c consilium -n '__consilium_no_subcommand' -a share -d 'Share a saved session'
complete -c consilium -n '__consilium_no_subcommand' -a voice -d 'Record audio, transcribe via Whisper'
complete -c consilium -n '__consilium_no_subcommand' -a agents -d 'Manage background agents'
complete -c consilium -n '__consilium_no_subcommand' -a scheduler -d 'Schedule recurring debates'
complete -c consilium -n '__consilium_no_subcommand' -a models -d 'Show default models and catalog'
complete -c consilium -n '__consilium_no_subcommand' -a mcp -d 'Manage MCP servers and integrations'
complete -c consilium -n '__consilium_no_subcommand' -a benchmark -d 'Run deliberation benchmarks'
complete -c consilium -n '__consilium_no_subcommand' -a eval -d 'Run blind evaluation of responses'
complete -c consilium -n '__consilium_no_subcommand' -a logs -d 'Query logs for a debate'
complete -c consilium -n '__consilium_no_subcommand' -a stats -d 'Show model performance dashboard'
complete -c consilium -n '__consilium_no_subcommand' -a redteam -d 'Run adversarial red team assessment'
complete -c consilium -n '__consilium_no_subcommand' -a debug -d 'Show full debug trace for a debate'
complete -c consilium -n '__consilium_no_subcommand' -a upgrade -d 'Update Consilium CLI to the latest version'
complete -c consilium -n '__consilium_no_subcommand' -a completions -d 'Print shell completion script'
complete -c consilium -n '__consilium_no_subcommand' -a debates -d 'List and manage debate sessions'
complete -c consilium -n '__consilium_no_subcommand' -a debate-pr -d 'Fetch and debate a GitHub PR'
complete -c consilium -n '__consilium_no_subcommand' -a debate-issue -d 'Fetch and debate a GitHub or Linear issue'
complete -c consilium -n '__consilium_no_subcommand' -a debate-failing -d 'Debate failing tests'
complete -c consilium -n '__consilium_no_subcommand' -a debate-staged -d 'Debate currently staged changes'
complete -c consilium -n '__consilium_no_subcommand' -a help -d 'Show help for a command'

complete -c consilium -n '__consilium_using_subcommand debate' -l mode -d 'Debate mode' -xa 'quick council deep blind redteam jury market auto'
complete -c consilium -n '__consilium_using_subcommand debate' -s m -l models -d 'Models to use' -x
complete -c consilium -n '__consilium_using_subcommand debate' -l output -d 'Output format' -xa 'markdown cursorrules claude-md json'
complete -c consilium -n '__consilium_using_subcommand debate' -l output-format -d 'Output format' -xa 'text json stream-json'
complete -c consilium -n '__consilium_using_subcommand debate' -l json-schema -d 'JSON Schema file' -r
complete -c consilium -n '__consilium_using_subcommand debate' -l max-budget-usd -d 'Cost limit in USD' -x
complete -c consilium -n '__consilium_using_subcommand debate' -l max-turns -d 'Cap debate at N rounds' -x
complete -c consilium -n '__consilium_using_subcommand debate' -l file -d 'Files to attach as context' -r
complete -c consilium -n '__consilium_using_subcommand debate' -l ticket -d 'Linear ticket ID' -x
complete -c consilium -n '__consilium_using_subcommand debate' -l plan -d 'Plan mode: emit written plan'
complete -c consilium -n '__consilium_using_subcommand debate' -l apply -d 'Apply structured edits'
complete -c consilium -n '__consilium_using_subcommand debate' -s b -l bg -d 'Run as detached background agent'
complete -c consilium -n '__consilium_using_subcommand debate' -l generate-image -d 'Generate image from synthesis'
complete -c consilium -n '__consilium_using_subcommand debate' -l image-prompt-from -d 'Image prompt source' -xa 'synthesis topic'
complete -c consilium -n '__consilium_using_subcommand debate' -l image-size -d 'Image size' -x
complete -c consilium -n '__consilium_using_subcommand debate' -l no-git -d 'Do not auto-attach git diff'
complete -c consilium -n '__consilium_using_subcommand debate' -l no-tools -d 'Do not expose tools to council'
complete -c consilium -n '__consilium_using_subcommand debate' -l no-context -d 'Disable codebase context'

complete -c consilium -n '__consilium_using_subcommand ask' -l mode -d 'Debate mode' -xa 'quick council deep blind redteam jury market auto'
complete -c consilium -n '__consilium_using_subcommand ask' -s m -l models -d 'Models to use' -x

complete -c consilium -n '__consilium_using_subcommand completions' -a 'bash zsh fish' -d 'Shell'

complete -c consilium -n '__consilium_using_subcommand sessions' -a 'list resume rename delete' -d 'Sessions subcommand'
complete -c consilium -n '__consilium_using_subcommand config' -a 'set get list' -d 'Config subcommand'
complete -c consilium -n '__consilium_using_subcommand mcp' -a 'setup add list remove test tools' -d 'MCP subcommand'
complete -c consilium -n '__consilium_using_subcommand debates' -a 'list cancel start stream' -d 'Debates subcommand'

complete -c consilium -n '__consilium_using_subcommand models' -l check -d 'Exit non-zero if defaults deprecated'
complete -c consilium -n '__consilium_using_subcommand models' -l json -d 'Emit as JSON'

complete -c consilium -n '__consilium_using_subcommand setup-token' -s n -l name -d 'Token label' -x
complete -c consilium -n '__consilium_using_subcommand setup-token' -s d -l days -d 'Lifetime in days' -x
complete -c consilium -n '__consilium_using_subcommand setup-token' -l print -d 'Print only the token'

complete -c consilium -n '__consilium_using_subcommand voice' -l once -d 'Record one clip and exit'
complete -c consilium -n '__consilium_using_subcommand voice' -s l -l language -d 'Language code' -x
complete -c consilium -n '__consilium_using_subcommand voice' -l debate -d 'Pipe transcript into debate'
complete -c consilium -n '__consilium_using_subcommand voice' -s m -l mode -d 'Debate mode' -xa 'quick council deep blind redteam jury market auto'
complete -c consilium -n '__consilium_using_subcommand voice' -l max-seconds -d 'Max recording seconds' -x
