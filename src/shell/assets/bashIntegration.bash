# Kitten semantic-prompt integration for interactive bash.
# Sourced by a generated --rcfile wrapper; never edits the user's dotfiles.

if [[ ${KITTEN_SHELL_INTEGRATION_ACTIVE:-} == 1 ]]; then
  return 0
fi

# A DEBUG trap is the bash preexec boundary. Do not replace an existing trap:
# another integration or user hook owns it, so Kitten degrades to raw scrollback.
if [[ -n ${KITTEN_EXISTING_BASH_DEBUG_TRAP:-} || -n $(trap -p DEBUG) ]]; then
  return 0
fi

export KITTEN_SHELL_INTEGRATION_ACTIVE=1
__kitten_command_active=0
__kitten_command_ready=0
__kitten_in_prompt_hook=0
declare -a __kitten_original_prompt_commands=()
if [[ $(declare -p PROMPT_COMMAND 2>/dev/null) == "declare -a"* ]]; then
  __kitten_original_prompt_commands=("${PROMPT_COMMAND[@]}")
elif [[ -n ${PROMPT_COMMAND:-} ]]; then
  __kitten_original_prompt_commands=("$PROMPT_COMMAND")
fi

__kitten_percent_encode() {
  local LC_ALL=C value=$1 output= char code i=0
  while (( i < ${#value} )); do
    char=${value:i:1}
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
  if [[ $__kitten_command_ready == 1 && $__kitten_in_prompt_hook == 0 ]]; then
    __kitten_command_ready=0
    __kitten_command_active=1
    printf '\033]133;C\007'
  fi
}

__kitten_prompt_command() {
  local status=$?
  __kitten_in_prompt_hook=1
  __kitten_command_ready=0

  if [[ $__kitten_command_active == 1 ]]; then
    printf '\033]133;D;%d\007' "$status"
    __kitten_command_active=0
  fi

  local original_prompt_command
  for original_prompt_command in "${__kitten_original_prompt_commands[@]}"; do
    eval "$original_prompt_command"
  done

  printf '\033]133;A\007'
  printf '\033]7;file://localhost%s\007' "$(__kitten_percent_encode "$PWD")"
  __kitten_command_ready=1
  __kitten_in_prompt_hook=0
}

PROMPT_COMMAND=__kitten_prompt_command
PS1="${PS1:-}\\[\033]133;B\007\\]"
trap '__kitten_preexec' DEBUG
