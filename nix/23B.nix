with import <nixpkgs> {};
writeShellApplication {
  name = "23B";
  runtimeInputs = [ coreutils ];
  text = builtins.readFile ./23B.sh;
}

