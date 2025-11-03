with import <nixpkgs> {};
writeShellApplication {
  name = "14";
  runtimeInputs = [ coreutils ];
  text = builtins.readFile ./14.sh;
}

