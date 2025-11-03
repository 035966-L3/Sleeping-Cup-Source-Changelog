with import <nixpkgs> {};
writeShellApplication {
  name = "11A";
  runtimeInputs = [ coreutils ];
  text = builtins.readFile ./11A.sh;
}

