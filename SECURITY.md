# Command execution

Tool arguments are validated on the server before starting a process. Commands
use fixed `flutter` or `dart` executables with separate arguments and no shell.
Paths containing spaces or shell metacharacters are passed literally, not split
or expanded. A path cannot be empty, contain NUL, or begin with `-` (which would
be interpreted as a command-line option). Use `./` for a filename beginning with
`-`.

`flutter_build` accepts only `apk`, `ios`, or `web`. Omitted optional arguments
retain their defaults; explicitly invalid values and unexpected properties are
rejected. `dart_run` requires a nonempty `file` argument.

## Windows compatibility

The shell-free runner requires directly executable SDK launchers. Standard
Windows Flutter/Dart `.bat` or `.cmd` launchers are not supported and fail closed.
Do not work around this by enabling `shell: true` or passing tool input to
`cmd.exe`. Windows support needs a separately tested, shell-free native launcher.

## Trust boundary

This protects against shell injection, not untrusted project code. The run,
test, build, and generation tools intentionally execute project code, and paths
are not restricted to the configured repository. Use trusted projects and SDKs,
keep `PATH` trusted, and run the server with only the privileges it needs.

## Regression tests

Run `npm ci` followed by `npm test`. Tests cover all seven command mappings,
runtime validation, option injection, and shell-injection payloads. Real-process
tests use temporary Flutter/Dart executable fixtures on POSIX systems, so no SDK
installation is needed. Those execution tests are skipped on Windows; they do
not establish Windows or real-SDK compatibility.
