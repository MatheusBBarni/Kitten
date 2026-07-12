# Kitten semantic-prompt integration for interactive zsh.
# Sourced from an isolated ZDOTDIR wrapper; never edits the user's dotfiles.

if [[ ${KITTEN_SHELL_INTEGRATION_ACTIVE:-} == 1 ]]; then
  return 0
fi

typeset -ga precmd_functions preexec_functions
typeset __kitten_existing_hooks="${(j: :)precmd_functions} ${(j: :)preexec_functions}"
if [[ $__kitten_existing_hooks == *vscode* || $__kitten_existing_hooks == *vsc_* ||
      $__kitten_existing_hooks == *iterm* || $__kitten_existing_hooks == *wezterm* ||
      $__kitten_existing_hooks == *kitty* || $__kitten_existing_hooks == *shell_integration* ]]; then
  unset __kitten_existing_hooks
  return 0
fi
unset __kitten_existing_hooks

export KITTEN_SHELL_INTEGRATION_ACTIVE=1
typeset -g __kitten_command_active=0
typeset -g __kitten_last_status=0

__kitten_percent_encode() {
  emulate -L zsh
  local LC_ALL=C value=$1 output= char code
  local -i i=1
  while (( i <= ${#value} )); do
    char=${value[i]}
    case $char in
      [-a-zA-Z0-9._~/]) output=${output}${char} ;;
      *)
        printf -v code '%02X' "'$char"
        output=${output}%${code}
        ;;
    esac
    (( i += 1 ))
  done
  printf '%s' "$output"
}

__kitten_preexec() {
  __kitten_command_active=1
  printf '\033]133;C;%s\007' "$(__kitten_percent_encode "$1")"
}

# This hook runs first so later prompt hooks cannot overwrite the command status.
__kitten_precmd_status() {
  __kitten_last_status=$?
  if (( __kitten_command_active )); then
    printf '\033]133;D;%d\007' "$__kitten_last_status"
    __kitten_command_active=0
  fi
}

# This hook runs last so cwd and the prompt-end marker describe the final prompt.
__kitten_precmd_prompt() {
  printf '\033]133;A\007'
  printf '\033]7;file://localhost%s\007' "$(__kitten_percent_encode "$PWD")"
  if [[ $PS1 != *']133;B'* ]]; then
    # Build the marker with ANSI-C quoting so zsh receives real ESC/BEL bytes.
    # A textual `\033`/`\007` inside PS1 is rendered by some prompts instead.
    PS1+=$'%{\e]133;B\a%}'
  fi
}

precmd_functions=(__kitten_precmd_status ${precmd_functions:#__kitten_precmd_status})
precmd_functions=(${precmd_functions:#__kitten_precmd_prompt} __kitten_precmd_prompt)
preexec_functions=(__kitten_preexec ${preexec_functions:#__kitten_preexec})
