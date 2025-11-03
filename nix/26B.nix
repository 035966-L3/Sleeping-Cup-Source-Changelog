with import <nixpkgs> {};
writeShellApplication {
  name = "26B";
  runtimeInputs = [ coreutils ];
  text = builtins.readFile ./26B.sh;
}

