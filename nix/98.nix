with import <nixpkgs> {};
writeShellApplication {
  name = "98";
  runtimeInputs = [ coreutils ];
  text = builtins.readFile ./98.sh;
}

