with import <nixpkgs> {};
writeShellApplication {
  name = "98A";
  runtimeInputs = [ coreutils ];
  text = builtins.readFile ./98A.sh;
}

