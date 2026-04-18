"""Shell completion generators for bash, zsh, and fish."""

from typing import List

_COMMANDS = [
    "init", "validate", "lint", "compile", "diff", "validate-all",
    "gate", "policy-check", "generate", "import", "resolve",
    "resolve-project", "diff-all", "transform", "standards", "sync",
    "fmt", "stats", "print-schema", "print-policy-schema", "doctor",
    "migrate", "apply", "watch",
]

_GENERATE_SUBCOMMANDS = ["sql", "dbt", "metadata", "docs", "changelog"]
_IMPORT_SUBCOMMANDS = ["sql", "dbml", "json-schema", "dbt", "avro"]
_TRANSFORM_SUBCOMMANDS = ["conceptual-to-logical", "logical-to-physical"]
_STANDARDS_SUBCOMMANDS = ["check", "fix"]
_SYNC_SUBCOMMANDS = ["compare", "merge", "pull"]
_DIALECTS = ["postgres", "snowflake", "bigquery", "databricks"]


def generate_bash_completion() -> str:
    cmds = " ".join(_COMMANDS)
    gen_subs = " ".join(_GENERATE_SUBCOMMANDS)
    imp_subs = " ".join(_IMPORT_SUBCOMMANDS)
    transform_subs = " ".join(_TRANSFORM_SUBCOMMANDS)
    standards_subs = " ".join(_STANDARDS_SUBCOMMANDS)
    sync_subs = " ".join(_SYNC_SUBCOMMANDS)
    dialects = " ".join(_DIALECTS)

    return f'''# bash completion for dm (DataLex CLI)
# Add to ~/.bashrc: eval "$(datalex completion bash)"

_dm_completions() {{
    local cur prev commands
    COMPREPLY=()
    cur="${{COMP_WORDS[COMP_CWORD]}}"
    prev="${{COMP_WORDS[COMP_CWORD-1]}}"
    commands="{cmds}"

    case "${{COMP_WORDS[1]}}" in
        generate)
            if [[ $COMP_CWORD -eq 2 ]]; then
                COMPREPLY=( $(compgen -W "{gen_subs}" -- "$cur") )
                return 0
            fi
            ;;
        import)
            if [[ $COMP_CWORD -eq 2 ]]; then
                COMPREPLY=( $(compgen -W "{imp_subs}" -- "$cur") )
                return 0
            fi
            ;;
        transform)
            if [[ $COMP_CWORD -eq 2 ]]; then
                COMPREPLY=( $(compgen -W "{transform_subs}" -- "$cur") )
                return 0
            fi
            ;;
        standards)
            if [[ $COMP_CWORD -eq 2 ]]; then
                COMPREPLY=( $(compgen -W "{standards_subs}" -- "$cur") )
                return 0
            fi
            ;;
        sync)
            if [[ $COMP_CWORD -eq 2 ]]; then
                COMPREPLY=( $(compgen -W "{sync_subs}" -- "$cur") )
                return 0
            fi
            ;;
    esac

    case "$prev" in
        --dialect)
            COMPREPLY=( $(compgen -W "{dialects}" -- "$cur") )
            return 0
            ;;
        --format)
            COMPREPLY=( $(compgen -W "json yaml table" -- "$cur") )
            return 0
            ;;
        --policy)
            COMPREPLY=( $(compgen -f -X '!*.policy.yaml' -- "$cur") )
            return 0
            ;;
        --schema)
            COMPREPLY=( $(compgen -f -X '!*.json' -- "$cur") )
            return 0
            ;;
    esac

    if [[ $COMP_CWORD -eq 1 ]]; then
        COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
        return 0
    fi

    COMPREPLY=( $(compgen -f -- "$cur") )
    return 0
}}

complete -F _dm_completions dm
'''


def generate_zsh_completion() -> str:
    cmds_list = "\n            ".join([f"'{c}:{c} command'" for c in _COMMANDS])
    gen_subs = " ".join(_GENERATE_SUBCOMMANDS)
    imp_subs = " ".join(_IMPORT_SUBCOMMANDS)
    transform_subs = " ".join(_TRANSFORM_SUBCOMMANDS)
    standards_subs = " ".join(_STANDARDS_SUBCOMMANDS)
    sync_subs = " ".join(_SYNC_SUBCOMMANDS)
    dialects = " ".join(_DIALECTS)

    return f'''#compdef dm
# zsh completion for dm (DataLex CLI)
# Add to ~/.zshrc: eval "$(datalex completion zsh)"

_dm() {{
    local -a commands
    commands=(
            {cmds_list}
    )

    _arguments -C \\
        '1:command:->command' \\
        '*::arg:->args'

    case $state in
        command)
            _describe 'dm commands' commands
            ;;
        args)
            case $words[1] in
                generate)
                    _values 'subcommand' {gen_subs}
                    ;;
                import)
                    _values 'subcommand' {imp_subs}
                    ;;
                transform)
                    _values 'subcommand' {transform_subs}
                    ;;
                standards)
                    _values 'subcommand' {standards_subs}
                    ;;
                sync)
                    _values 'subcommand' {sync_subs}
                    ;;
                *)
                    case $words[-2] in
                        --dialect)
                            _values 'dialect' {dialects}
                            ;;
                        --format)
                            _values 'format' json yaml table
                            ;;
                        --policy)
                            _files -g '*.policy.yaml'
                            ;;
                        --schema)
                            _files -g '*.json'
                            ;;
                        *)
                            _files
                            ;;
                    esac
                    ;;
            esac
            ;;
    esac
}}

_dm "$@"
'''


def generate_fish_completion() -> str:
    lines = [
        "# fish completion for dm (DataLex CLI)",
        "# Add to ~/.config/fish/completions/dm.fish",
        "",
    ]

    for cmd in _COMMANDS:
        lines.append(f"complete -c dm -n '__fish_use_subcommand' -a '{cmd}' -d '{cmd} command'")

    lines.append("")
    for sub in _GENERATE_SUBCOMMANDS:
        lines.append(f"complete -c dm -n '__fish_seen_subcommand_from generate' -a '{sub}'")
    for sub in _IMPORT_SUBCOMMANDS:
        lines.append(f"complete -c dm -n '__fish_seen_subcommand_from import' -a '{sub}'")
    for sub in _TRANSFORM_SUBCOMMANDS:
        lines.append(f"complete -c dm -n '__fish_seen_subcommand_from transform' -a '{sub}'")
    for sub in _STANDARDS_SUBCOMMANDS:
        lines.append(f"complete -c dm -n '__fish_seen_subcommand_from standards' -a '{sub}'")
    for sub in _SYNC_SUBCOMMANDS:
        lines.append(f"complete -c dm -n '__fish_seen_subcommand_from sync' -a '{sub}'")

    lines.append("")
    for d in _DIALECTS:
        lines.append(f"complete -c dm -l dialect -a '{d}'")
    lines.append("complete -c dm -l format -a 'json yaml table'")

    return "\n".join(lines) + "\n"
