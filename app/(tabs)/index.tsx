import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  StyleSheet,
  Alert,
  Dimensions,
  PanResponder,
  Animated,
  FlatList,
  Modal,
} from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import { SafeAreaView } from 'react-native-safe-area-context';
import { calculateAlbumPosition, getOptimalLayoutConfig, getNearestAlbumIndex, LayoutPosition } from '@/utils/layoutUtils';
import { HistoryManager, HistoryState } from '@/utils/historyManager';

interface Album {
  id: string;
  title: string;
  assetCount: number;
  assets: MediaLibrary.Asset[];
}

interface Photo {
  id: string;
  uri: string;
  albumId: string;
  status: 'normal' | 'deleted' | 'pending';
}

const { width, height } = Dimensions.get('window');

export default function HomeScreen() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [permission, setPermission] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [draggedPhotoIndex, setDraggedPhotoIndex] = useState<number | null>(null);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const [albumPositions, setAlbumPositions] = useState<LayoutPosition[]>([]);
  const [layoutConfig, setLayoutConfig] = useState(getOptimalLayoutConfig(0, width, 200));

  const historyManager = useRef(new HistoryManager());
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (evt) => {
        if (draggedPhotoIndex !== null) {
          setDragPosition({
            x: evt.nativeEvent.pageX,
            y: evt.nativeEvent.pageY,
          });
        }
      },
      onPanResponderRelease: (evt) => {
        if (draggedPhotoIndex !== null) {
          const releaseX = evt.nativeEvent.pageX;
          const releaseY = evt.nativeEvent.pageY;
          handleDragRelease(releaseX, releaseY);
        }
      },
    })
  ).current;

  // 获取相册权限
  useEffect(() => {
    requestMediaLibraryPermission();
  }, []);

  // 加载相册
  useEffect(() => {
    if (permission) {
      loadAlbums();
    }
  }, [permission]);

  // 当选择相册时加载照片
  useEffect(() => {
    if (selectedAlbum) {
      loadPhotosFromAlbum(selectedAlbum);
      setSelectedIndices(new Set());
      setIsBatchMode(false);
    }
  }, [selectedAlbum]);

  // 计算相册位置
  useEffect(() => {
    if (selectedAlbum) {
      const otherAlbums = albums.filter((a) => a.id !== selectedAlbum.id);
      const config = getOptimalLayoutConfig(otherAlbums.length, width, 200);
      setLayoutConfig(config);

      const positions = otherAlbums.map((_, index) =>
        calculateAlbumPosition(index, otherAlbums.length, config)
      );
      setAlbumPositions(positions);
    }
  }, [selectedAlbum, albums]);

  const requestMediaLibraryPermission = async () => {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    setPermission(status === 'granted');
    if (status !== 'granted') {
      Alert.alert('权限被拒绝', '需要访问相册权限才能使用此应用');
    }
  };

  const loadAlbums = async () => {
    try {
      const allAlbums = await MediaLibrary.getAlbumsAsync();
      const albumsWithAssets = await Promise.all(
        allAlbums.map(async (album) => {
          const assets = await MediaLibrary.getAssetsAsync({
            album: album,
            mediaType: 'photo',
          });
          return {
            id: album.id,
            title: album.title,
            assetCount: assets.assets.length,
            assets: assets.assets,
          };
        })
      );
      setAlbums(albumsWithAssets.filter((a) => a.assetCount > 0));
    } catch (error) {
      console.error('加载相册失败:', error);
      Alert.alert('错误', '加载相册失败');
    }
  };

  const loadPhotosFromAlbum = async (album: Album) => {
    const photoList: Photo[] = album.assets.map((asset) => ({
      id: asset.id,
      uri: asset.uri,
      albumId: album.id,
      status: 'normal',
    }));
    setPhotos(photoList);
    setCurrentPhotoIndex(0);

    // 保存到历史记录
    historyManager.current.addHistory({
      photos: photoList,
      selectedIndices: new Set(),
      timestamp: Date.now(),
    });
  };

  const saveToHistory = (newPhotos: Photo[], newSelectedIndices: Set<number>) => {
    historyManager.current.addHistory({
      photos: newPhotos,
      selectedIndices: newSelectedIndices,
      timestamp: Date.now(),
    });
  };

  const handleUndo = () => {
    const prevState = historyManager.current.undo();
    if (prevState) {
      setPhotos(prevState.photos);
      setSelectedIndices(new Set(prevState.selectedIndices));
    }
  };

  const handleRedo = () => {
    const nextState = historyManager.current.redo();
    if (nextState) {
      setPhotos(nextState.photos);
      setSelectedIndices(new Set(nextState.selectedIndices));
    }
  };

  const handleSwipeUp = () => {
    if (isBatchMode && selectedIndices.size > 0) {
      // 批量删除
      const updatedPhotos = photos.filter((_, i) => !selectedIndices.has(i));
      setPhotos(updatedPhotos);
      setSelectedIndices(new Set());
      saveToHistory(updatedPhotos, new Set());
      Alert.alert('已删除', `已删除 ${selectedIndices.size} 张照片`);
    } else if (photos[currentPhotoIndex]) {
      // 单张删除
      const updatedPhotos = photos.filter((_, i) => i !== currentPhotoIndex);
      setPhotos(updatedPhotos);
      if (currentPhotoIndex >= updatedPhotos.length && currentPhotoIndex > 0) {
        setCurrentPhotoIndex(currentPhotoIndex - 1);
      }
      saveToHistory(updatedPhotos, new Set());
      Alert.alert('已删除', '图片已从列表中删除');
    }
  };

  const handleSwipeLeft = () => {
    if (isBatchMode && selectedIndices.size > 0) {
      // 批量标记为待定
      const updatedPhotos = [...photos];
      selectedIndices.forEach((i) => {
        updatedPhotos[i].status = 'pending';
      });
      setPhotos(updatedPhotos);
      setSelectedIndices(new Set());
      saveToHistory(updatedPhotos, new Set());
      Alert.alert('已标记', `已标记 ${selectedIndices.size} 张照片为待定`);
    } else if (photos[currentPhotoIndex]) {
      // 单张标记为待定
      const updatedPhotos = [...photos];
      updatedPhotos[currentPhotoIndex].status = 'pending';
      setPhotos(updatedPhotos);
      saveToHistory(updatedPhotos, new Set());
      Alert.alert('已标记', '图片已标记为待定');
    }
  };

  const handleNextPhoto = () => {
    if (currentPhotoIndex < photos.length - 1) {
      setCurrentPhotoIndex(currentPhotoIndex + 1);
    }
  };

  const handlePrevPhoto = () => {
    if (currentPhotoIndex > 0) {
      setCurrentPhotoIndex(currentPhotoIndex - 1);
    }
  };

  const handlePhotoLongPress = (index: number) => {
    if (!isBatchMode) {
      setIsBatchMode(true);
    }
    const newSelected = new Set(selectedIndices);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedIndices(newSelected);
  };

  const handlePhotoPress = (index: number) => {
    if (isBatchMode) {
      handlePhotoLongPress(index);
    } else {
      setCurrentPhotoIndex(index);
    }
  };

  const handleDragStart = (index: number) => {
    setDraggedPhotoIndex(index);
  };

  const handleDragRelease = (releaseX: number, releaseY: number) => {
    if (draggedPhotoIndex === null) return;

    const nearestIndex = getNearestAlbumIndex(
      releaseX,
      releaseY,
      albumPositions,
      40
    );

    if (nearestIndex !== null) {
      const otherAlbums = albums.filter((a) => a.id !== selectedAlbum?.id);
      const targetAlbum = otherAlbums[nearestIndex];
      movePhotoToAlbum(draggedPhotoIndex, targetAlbum);
    }

    setDraggedPhotoIndex(null);
    setDragPosition({ x: 0, y: 0 });
  };

  const movePhotoToAlbum = async (photoIndex: number, targetAlbum: Album) => {
    if (!selectedAlbum) return;

    try {
      const updatedPhotos = photos.filter((_, i) => i !== photoIndex);
      setPhotos(updatedPhotos);
      if (currentPhotoIndex >= updatedPhotos.length && currentPhotoIndex > 0) {
        setCurrentPhotoIndex(currentPhotoIndex - 1);
      }
      saveToHistory(updatedPhotos, new Set());
      Alert.alert('成功', `已将照片移动到 ${targetAlbum.title}`);
    } catch (error) {
      console.error('移动照片失败:', error);
      Alert.alert('错误', '移动照片失败');
    }
  };

  const moveSelectedPhotosToAlbum = (targetAlbum: Album) => {
    if (selectedIndices.size === 0) return;

    const updatedPhotos = photos.filter((_, i) => !selectedIndices.has(i));
    setPhotos(updatedPhotos);
    setSelectedIndices(new Set());
    saveToHistory(updatedPhotos, new Set());
    Alert.alert('成功', `已将 ${selectedIndices.size} 张照片移动到 ${targetAlbum.title}`);
  };

  const exitBatchMode = () => {
    setIsBatchMode(false);
    setSelectedIndices(new Set());
  };

  if (!permission) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.centerText}>需要相册访问权限</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={requestMediaLibraryPermission}
        >
          <Text style={styles.buttonText}>授予权限</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (albums.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.centerText}>未找到相册</Text>
        <TouchableOpacity style={styles.button} onPress={loadAlbums}>
          <Text style={styles.buttonText}>重新加载</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (!selectedAlbum) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>选择相册进行分类</Text>
        <ScrollView style={styles.albumList}>
          {albums.map((album) => (
            <TouchableOpacity
              key={album.id}
              style={styles.albumItem}
              onPress={() => setSelectedAlbum(album)}
            >
              <View style={styles.albumInfo}>
                <Text style={styles.albumTitle}>{album.title}</Text>
                <Text style={styles.albumCount}>{album.assetCount} 张照片</Text>
              </View>
              <Text style={styles.arrow}>›</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  const currentPhoto = photos[currentPhotoIndex];
  const otherAlbums = albums.filter((a) => a.id !== selectedAlbum.id);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setSelectedAlbum(null)}>
          <Text style={styles.backButton}>‹ 返回</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {isBatchMode ? `已选择 ${selectedIndices.size} 张` : selectedAlbum.title}
        </Text>
        <View style={styles.headerControls}>
          {historyManager.current.canUndo() && (
            <TouchableOpacity onPress={handleUndo} style={styles.iconButton}>
              <Text style={styles.iconButtonText}>↶</Text>
            </TouchableOpacity>
          )}
          {isBatchMode && (
            <TouchableOpacity onPress={exitBatchMode} style={styles.iconButton}>
              <Text style={styles.iconButtonText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {isBatchMode ? (
        // 批量模式：显示照片网格
        <View style={styles.batchModeContainer}>
          <FlatList
            data={photos}
            numColumns={4}
            keyExtractor={(item) => item.id}
            renderItem={({ item, index }) => (
              <TouchableOpacity
                style={[
                  styles.photoThumbnail,
                  selectedIndices.has(index) && styles.photoThumbnailSelected,
                ]}
                onPress={() => handlePhotoPress(index)}
              >
                <Image
                  source={{ uri: item.uri }}
                  style={styles.photoThumbnailImage}
                />
                {selectedIndices.has(index) && (
                  <View style={styles.checkmark}>
                    <Text style={styles.checkmarkText}>✓</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}
          />
        </View>
      ) : (
        // 单张模式：显示大图
        <>
          {currentPhoto && (
            <TouchableOpacity
              style={styles.photoContainer}
              {...panResponder.panHandlers}
              onLongPress={() => handleDragStart(currentPhotoIndex)}
            >
              <Image
                source={{ uri: currentPhoto.uri }}
                style={styles.photo}
                resizeMode="contain"
              />
              <View style={styles.gestureHints}>
                <Text style={styles.hint}>👆 上滑删除</Text>
                <Text style={styles.hint}>👈 左划待定</Text>
                <Text style={styles.hint}>长按拖拽</Text>
              </View>
            </TouchableOpacity>
          )}

          <View style={styles.albumGrid}>
            <Text style={styles.gridTitle}>拖拽到相册分类</Text>
            <View style={styles.circleLayout}>
              {otherAlbums.map((album, index) => {
                const pos = albumPositions[index];
                if (!pos) return null;

                return (
                  <TouchableOpacity
                    key={album.id}
                    style={[
                      styles.albumCircle,
                      {
                        transform: [
                          { translateX: pos.x - layoutConfig.centerX },
                          { translateY: pos.y - layoutConfig.centerY },
                          { scale: pos.scale },
                        ],
                      },
                    ]}
                    onPress={() => movePhotoToAlbum(currentPhotoIndex, album)}
                  >
                    <Text style={styles.albumCircleText}>{album.title}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </>
      )}

      <View style={styles.controls}>
        {!isBatchMode ? (
          <>
            <TouchableOpacity
              style={[styles.controlButton, currentPhotoIndex === 0 && styles.disabled]}
              onPress={handlePrevPhoto}
              disabled={currentPhotoIndex === 0}
            >
              <Text style={styles.controlButtonText}>上一张</Text>
            </TouchableOpacity>

            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={[styles.actionButton, styles.deleteButton]}
                onPress={handleSwipeUp}
              >
                <Text style={styles.actionButtonText}>删除</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.pendingButton]}
                onPress={handleSwipeLeft}
              >
                <Text style={styles.actionButtonText}>待定</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.batchButton]}
                onPress={() => handlePhotoLongPress(currentPhotoIndex)}
              >
                <Text style={styles.actionButtonText}>批量</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[
                styles.controlButton,
                currentPhotoIndex === photos.length - 1 && styles.disabled,
              ]}
              onPress={handleNextPhoto}
              disabled={currentPhotoIndex === photos.length - 1}
            >
              <Text style={styles.controlButtonText}>下一张</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity
              style={[styles.actionButton, styles.deleteButton]}
              onPress={handleSwipeUp}
            >
              <Text style={styles.actionButtonText}>删除已选</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.pendingButton]}
              onPress={handleSwipeLeft}
            >
              <Text style={styles.actionButtonText}>待定已选</Text>
            </TouchableOpacity>
            <ScrollView
              horizontal
              style={styles.batchAlbumScroll}
              showsHorizontalScrollIndicator={false}
            >
              {otherAlbums.map((album) => (
                <TouchableOpacity
                  key={album.id}
                  style={styles.batchAlbumButton}
                  onPress={() => moveSelectedPhotosToAlbum(album)}
                >
                  <Text style={styles.batchAlbumButtonText}>{album.title}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centerText: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 20,
    color: '#666',
  },
  button: {
    marginTop: 20,
    marginHorizontal: 20,
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: '#007AFF',
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 10,
  },
  albumList: {
    flex: 1,
    marginHorizontal: 10,
  },
  albumItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
    paddingHorizontal: 15,
    marginVertical: 5,
    backgroundColor: '#fff',
    borderRadius: 8,
    marginHorizontal: 10,
  },
  albumInfo: {
    flex: 1,
  },
  albumTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  albumCount: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
  arrow: {
    fontSize: 24,
    color: '#ccc',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  backButton: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    flex: 1,
    textAlign: 'center',
  },
  photoCount: {
    fontSize: 14,
    color: '#999',
  },
  headerControls: {
    flexDirection: 'row',
    gap: 10,
  },
  iconButton: {
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  iconButtonText: {
    fontSize: 18,
    color: '#007AFF',
    fontWeight: '600',
  },
  photoContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    marginVertical: 10,
    borderRadius: 8,
    marginHorizontal: 10,
    overflow: 'hidden',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  gestureHints: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
  },
  hint: {
    color: '#fff',
    fontSize: 11,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  albumGrid: {
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  gridTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 10,
    textAlign: 'center',
  },
  circleLayout: {
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  albumCircle: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  albumCircleText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 15,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#eee',
    gap: 10,
  },
  controlButton: {
    paddingVertical: 10,
    paddingHorizontal: 15,
    backgroundColor: '#007AFF',
    borderRadius: 6,
  },
  controlButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  disabled: {
    backgroundColor: '#ccc',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 8,
    flex: 1,
    justifyContent: 'center',
  },
  actionButton: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  deleteButton: {
    backgroundColor: '#FF3B30',
  },
  pendingButton: {
    backgroundColor: '#FF9500',
  },
  batchButton: {
    backgroundColor: '#5AC8FA',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  batchModeContainer: {
    flex: 1,
    paddingHorizontal: 5,
    paddingVertical: 10,
  },
  photoThumbnail: {
    flex: 1,
    aspectRatio: 1,
    margin: 5,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#e0e0e0',
  },
  photoThumbnailImage: {
    width: '100%',
    height: '100%',
  },
  photoThumbnailSelected: {
    borderWidth: 3,
    borderColor: '#007AFF',
  },
  checkmark: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmarkText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  batchAlbumScroll: {
    flex: 1,
  },
  batchAlbumButton: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginHorizontal: 5,
    backgroundColor: '#007AFF',
    borderRadius: 6,
    justifyContent: 'center',
  },
  batchAlbumButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
