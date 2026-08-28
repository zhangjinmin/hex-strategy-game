package main

import (
	"context"
	"os"
	"path/filepath"
)

type App struct {
	ctx context.Context
}

func NewApp() *App                         { return &App{} }
func (a *App) startup(ctx context.Context) { a.ctx = ctx }

// 获取与 exe 绝对绑定的存档文件路径
func getSavePath() string {
	exePath, err := os.Executable()
	if err != nil {
		return "HexFront_Saves.json"
	}
	exeDir := filepath.Dir(exePath)
	// wails dev 编译产物在 <project>/build/bin/xxx.exe
	// 向上一级到项目根目录，方便开发期查看与备份
	if filepath.Base(exeDir) == "bin" {
		return filepath.Join(filepath.Dir(exeDir), "HexFront_Saves.json")
	}
	return filepath.Join(exeDir, "HexFront_Saves.json")
}

// SaveGameData 供前端写入存档
func (a *App) SaveGameData(jsonData string) error {
	return os.WriteFile(getSavePath(), []byte(jsonData), 0644)
}

// LoadGameData 供前端读取存档
func (a *App) LoadGameData() (string, error) {
	data, err := os.ReadFile(getSavePath())
	if err != nil {
		return "", err
	}
	return string(data), nil
}
